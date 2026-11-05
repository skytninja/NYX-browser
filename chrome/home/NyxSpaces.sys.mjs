// Spaces: fully separate profiles side by side in the Profiles folder, each run as its own process.
// The list lives in Profiles/spaces.json, so every space sees the same list.

const MAIN = { id: "default", name: "Основное" };
const ID_PATTERN = /^space-[0-9a-f]{8}$/;
const MAX_NAME = 30;
const COPIED_FILES = ["nyx-theme.json"];

const profileDir = () => Services.dirsvc.get("ProfD", Ci.nsIFile).path;
const profilesDir = () => PathUtils.parent(profileDir());
const listFile = () => PathUtils.join(profilesDir(), "spaces.json");
const spaceDir = id => PathUtils.join(profilesDir(), id);

// The .app that is running now: …/NYX Browser.app/Contents/MacOS/firefox.
function appPath() {
  const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  return exe.parent.parent.parent.path;
}

async function readStored() {
  try {
    const raw = await IOUtils.readJSON(listFile());
    return Array.isArray(raw)
      ? raw.filter(space => ID_PATTERN.test(space?.id) && typeof space.name === "string")
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

// The launcher always starts the browser with "--profile <dir>", so pgrep finds an open space.
function isRunning(id) {
  return runTool("/usr/bin/pgrep", ["-f", "--", `--profile ${escapeRegExp(spaceDir(id))}( |$)`]) === 0;
}

export const NyxSpaces = {
  MAX_NAME,

  get currentId() {
    return PathUtils.filename(profileDir());
  },

  async list() {
    return [MAIN, ...(await readStored())];
  },

  async create(rawName) {
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
    spaces.push({ id, name });
    await writeStored(spaces);
    return { id, name };
  },

  // A space that is already open just gets a new window from its own process.
  async open(id) {
    if (!(await this.list()).some(space => space.id === id)) throw new Error(`unknown space ${id}`);
    // open returns as soon as macOS has started the app.
    runTool("/usr/bin/open", ["-n", "-a", appPath(), "--env", `NYX_PROFILE_DIR=${spaceDir(id)}`]);
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
