// Update check: once a day NYX reads latest.json from the GitHub Pages site and, if a newer
// version is out, shows a bar that leads to the download page. Nothing is installed by itself.

import { NyxTheme } from "chrome://nyx/content/NyxTheme.sys.mjs";

const REPO_PAGE = "https://skytninja.github.io/NYX-browser/";
const LATEST_URL = `${REPO_PAGE}latest.json`;
const DOWNLOAD_PAGE = `${REPO_PAGE}#download`;
const CHECK_EVERY_S = 24 * 60 * 60;
const TIMER_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 30 * 1000;
const LAST_CHECK_PREF = "nyx.update.lastCheck";
const SKIPPED_PREF = "nyx.update.skipped";
const NOTIFICATION_ID = "nyx-update";
const VERSION = /^\d+\.\d+\.\d+$/;

let timer = null;

function installedVersion() {
  const file = Services.dirsvc.get("GreD", Ci.nsIFile);
  file.append("nyx-version");
  try {
    const version = Cu.readUTF8File(file).trim();
    return VERSION.test(version) ? version : null;
  } catch {
    return null;
  }
}

function isNewer(candidate, current) {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function showBar(win, version, current) {
  const box = win.gNotificationBox;
  if (box.getNotificationWithValue(NOTIFICATION_ID)) return;
  box.appendNotification(
    NOTIFICATION_ID,
    { label: `Доступна NYX Browser ${version}. У тебя ${current}.`, priority: box.PRIORITY_INFO_MEDIUM },
    [
      {
        label: "Скачать",
        callback: () => win.openTrustedLinkIn(DOWNLOAD_PAGE, "tab"),
      },
      {
        label: "Пропустить версию",
        callback: () => Services.prefs.setStringPref(SKIPPED_PREF, version),
      },
    ]
  );
}

async function check() {
  // Turned off in settings: not a single request goes out.
  if (!NyxTheme.settings.updateCheck) return;
  const now = Math.floor(Date.now() / 1000);
  if (now - Services.prefs.getIntPref(LAST_CHECK_PREF, 0) < CHECK_EVERY_S) return;
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const current = installedVersion();
  if (!win || !current) return;
  Services.prefs.setIntPref(LAST_CHECK_PREF, now);

  // The pref exists only for tests against a local file.
  const response = await win.fetch(Services.prefs.getStringPref("nyx.update.url", LATEST_URL), { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`latest.json: HTTP ${response.status}`);
  const { version } = await response.json();
  if (!VERSION.test(version) || !isNewer(version, current)) return;
  if (Services.prefs.getStringPref(SKIPPED_PREF, "") === version) return;
  showBar(win, version, current);
}

function safeCheck() {
  check().catch(error => console.warn("NYX: update check failed", error));
}

export const NyxUpdates = {
  start() {
    if (timer) return;
    timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    // A quiet start: the first check waits until the browser has settled.
    timer.initWithCallback(() => {
      safeCheck();
      timer.initWithCallback(safeCheck, TIMER_MS, Ci.nsITimer.TYPE_REPEATING_SLACK);
    }, FIRST_CHECK_MS, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  // For tests: check now, ignoring the once-a-day limit.
  checkNow() {
    Services.prefs.clearUserPref(LAST_CHECK_PREF);
    return check();
  },
};
