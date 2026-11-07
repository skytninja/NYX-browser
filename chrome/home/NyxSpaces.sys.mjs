// Spaces: fully separate profiles side by side in the Profiles folder, each run as its own process.
// The list lives in Profiles/spaces.json, so every space sees the same list.

const MAIN = { id: "default", name: "Основное" };
const ID_PATTERN = /^space-[0-9a-f]{8}$/;
const MAX_NAME = 30;
const COPIED_FILES = ["nyx-theme.json", "nyx-home-background.jpg"];
// The strip on top of a space's windows. Only these values ever reach CSS.
export const SPACE_COLORS = ["#d8d8d8", "#ff5f57", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#0a84ff", "#bf5af2"];
// Sent to a running space: bring its window forward instead of opening another one.
export const FOCUS_FLAG = "nyx-focus";

const profileDir = () => Services.dirsvc.get("ProfD", Ci.nsIFile).path;
const profilesDir = () => PathUtils.parent(profileDir());
const listFile = () => PathUtils.join(profilesDir(), "spaces.json");
const spaceDir = id => PathUtils.join(profilesDir(), id);

const IS_WINDOWS = Services.appinfo.OS === "WINNT";

// The .app that is running now: …/NYX Browser.app/Contents/MacOS/firefox.
function appPath() {
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  return exe.parent.parent.parent.path;
}

// Windows: NYX's own launcher sits next to firefox.exe and passes the profile on.
function windowsLauncher() {
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const launcher = exe.parent.clone();
  launcher.append("nyx.exe");
  return launcher;
}

function startProcess(file, args, { hidden = false } = {}) {
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(file);
  process.startHidden = hidden;
  // runw passes arguments as UTF-16 and quotes them for Windows.
  process.runw(false, args, args.length);
}

async function readStored() {
  try {
    const raw = await IOUtils.readJSON(listFile());
    return Array.isArray(raw)
      ? raw
          .filter(space => ID_PATTERN.test(space?.id) && typeof space.name === "string")
          .map(({ id, name, color, temporary }) => ({
            id,
            name,
            ...(SPACE_COLORS.includes(color) && { color }),
            ...(temporary === true && { temporary }),
          }))
      : [];
  } catch (error) {
    if (error.name !== "NotFoundError") console.error("NYX: spaces list unreadable", error);
    return [];
  }
}

function writeStored(spaces) {
  return IOUtils.writeJSON(listFile(), spaces, { tmpPath: `${listFile()}.tmp` });
}

function runTool(path, args) {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(file);
  process.run(true, args, args.length);
  return process.exitValue;
}

// pgrep reads its pattern as a regular expression, so the path is matched literally.
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// macOS: the launcher always starts the browser with "--profile <dir>", so pgrep finds an open space.
// Windows: Firefox holds parent.lock open with delete-on-close, so the file exists only while it runs.
function isRunning(id) {
  if (IS_WINDOWS) {
    const lock = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    lock.initWithPath(PathUtils.join(spaceDir(id), "parent.lock"));
    return lock.exists();
  }
  return runTool("/usr/bin/pgrep", ["-f", "--", `--profile ${escapeRegExp(spaceDir(id))}( |$)`]) === 0;
}

// PowerShell gets the script base64-encoded, and the folder inside it as a single-quoted
// string ('' escapes a quote), so nothing in the path can turn into a command.
function eraseAfterExitWindows(dir) {
  const quoted = `'${dir.replaceAll("'", "''")}'`;
  const script = `$d = ${quoted}; $lock = Join-Path $d 'parent.lock'
while (Test-Path -LiteralPath $lock) { Start-Sleep -Seconds 1 }
for ($i = 0; $i -lt 30 -and (Test-Path -LiteralPath $d); $i++) {
  Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1
}`;
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    bytes[i * 2] = script.charCodeAt(i) & 0xff;
    bytes[i * 2 + 1] = script.charCodeAt(i) >> 8;
  }
  const encoded = btoa(String.fromCharCode(...bytes));
  const powershell = Services.dirsvc.get("SysD", Ci.nsIFile);
  powershell.append("WindowsPowerShell");
  powershell.append("v1.0");
  powershell.append("powershell.exe");
  startProcess(powershell, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { hidden: true });
}

// Deletes a temporary space's folder once this process (the space itself) has exited.
function eraseAfterExit(dir) {
  if (IS_WINDOWS) {
    eraseAfterExitWindows(dir);
    return;
  }
  const shell = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  shell.initWithPath("/bin/sh");
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(shell);
  // The folder comes in as an argument, never as part of the script.
  const script = 'while kill -0 "$1" 2>/dev/null; do sleep 1; done; rm -rf -- "$2"';
  process.runAsync(["-c", script, "nyx-erase", String(Services.appinfo.processID), dir], 5);
}

export const NyxSpaces = {
  MAX_NAME,

  get currentId() {
    return PathUtils.filename(profileDir());
  },

  async list() {
    const stored = await readStored();
    // A temporary space whose folder is already gone has ended.
    const alive = [];
    for (const space of stored) {
      if (!space.temporary || space.id === this.currentId || (await IOUtils.exists(spaceDir(space.id)))) alive.push(space);
    }
    if (alive.length !== stored.length) await writeStored(alive);
    return [MAIN, ...alive];
  },

  // Like incognito, but with tabs and logins until it's closed. Then everything is erased.
  createTemporary() {
    return this.create("Временное", { temporary: true });
  },

  // Called at startup of every space: a temporary space erases itself on exit,
  // and leftovers of temporary spaces that crashed are swept.
  async startTemporaryHandling() {
    const stored = await readStored();
    if (stored.some(space => space.id === this.currentId && space.temporary)) {
      const dir = profileDir();
      // A restart (add-on update, troubleshoot mode) comes back on the same folder: only a real exit erases it.
      let restarting = false;
      Services.obs.addObserver((subject, topic, data) => {
        restarting = data === "restart";
      }, "quit-application");
      Services.obs.addObserver(() => {
        if (!restarting) eraseAfterExit(dir);
      }, "profile-before-change");
      // On macOS closing the last window keeps the app running. Here closing it means "done".
      Services.obs.addObserver(closed => {
        Services.tm.dispatchToMainThread(() => {
          const left = [...Services.wm.getEnumerator("navigator:browser")].filter(win => win !== closed && !win.closed);
          if (!left.length) Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
        });
      }, "domwindowclosed");
    }
    for (const space of stored) {
      if (space.temporary && space.id !== this.currentId && !isRunning(space.id)) await this.remove(space.id);
    }
  },

  async create(rawName, { temporary = false } = {}) {
    const name = String(rawName).trim().slice(0, MAX_NAME);
    if (!name) throw new Error("empty name");
    const id = `space-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await IOUtils.makeDirectory(spaceDir(id), { permissions: 0o700 });
    // The new space starts with the same look as the one it was made from.
    for (const file of COPIED_FILES) {
      const source = PathUtils.join(profileDir(), file);
      if (await IOUtils.exists(source)) await IOUtils.copy(source, PathUtils.join(spaceDir(id), file));
    }
    const spaces = await readStored();
    const space = temporary ? { id, name, temporary } : { id, name };
    spaces.push(space);
    await writeStored(spaces);
    return space;
  },

  // Opens the space, or brings it forward if it's already running. With a url, opens that link in it.
  async open(id, url = null) {
    if (!(await this.list()).some(space => space.id === id)) throw new Error(`unknown space ${id}`);
    if (url !== null && !/^https?:$/.test(new URL(url).protocol)) throw new Error("only web links open in a space");
    // A running space gets this command line through Firefox's own remote handling.
    const args = url === null ? [`-${FOCUS_FLAG}`] : [url];
    if (IS_WINDOWS) {
      startProcess(windowsLauncher(), [`--nyx-profile=${spaceDir(id)}`, ...args]);
      return;
    }
    // open returns as soon as macOS has started the app.
    runTool("/usr/bin/open", ["-n", "-a", appPath(), "--env", `NYX_PROFILE_DIR=${spaceDir(id)}`, "--args", ...args]);
  },

  async colorOf(id) {
    return (await readStored()).find(space => space.id === id)?.color ?? null;
  },

  // null clears the color. The main space has none.
  async setColor(id, color) {
    if (!ID_PATTERN.test(id)) throw new Error(`space ${id} has no color`);
    if (color !== null && !SPACE_COLORS.includes(color)) throw new Error(`unknown color ${color}`);
    const spaces = await readStored();
    const space = spaces.find(item => item.id === id);
    if (!space) throw new Error(`unknown space ${id}`);
    if (color) space.color = color;
    else delete space.color;
    await writeStored(spaces);
    if (id === this.currentId) await this.applyColor();
  },

  // Paints this space's strip in every window of this process.
  async applyColor(win = null) {
    const color = await this.colorOf(this.currentId);
    const windows = win ? [win] : Services.wm.getEnumerator("navigator:browser");
    for (const each of windows) {
      const root = each.document.documentElement;
      if (color) {
        root.setAttribute("nyx-space-color", "");
        root.style.setProperty("--nyx-space-color", color);
      } else {
        root.removeAttribute("nyx-space-color");
        root.style.removeProperty("--nyx-space-color");
      }
    }
  },

  // Returns false when the space is open somewhere and can't be deleted right now.
  async remove(id) {
    if (!ID_PATTERN.test(id) || id === this.currentId) throw new Error(`space ${id} can't be removed`);
    if (isRunning(id)) return false;
    await writeStored((await readStored()).filter(space => space.id !== id));
    await IOUtils.remove(spaceDir(id), { recursive: true, ignoreAbsent: true });
    return true;
  },
};
