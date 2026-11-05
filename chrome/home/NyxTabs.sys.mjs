// Tab auto-cleanup and the "too many tabs" warning. Settings live in NyxTheme (nyx-theme.json).

import { NyxTheme } from "chrome://nyx/content/NyxTheme.sys.mjs";

const CHECK_EVERY_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WARNING_ID = "nyx-too-many-tabs";

const warned = new WeakSet();
let timer = null;

function browserWindows() {
  return [...Services.wm.getEnumerator("navigator:browser")].filter(win => win.gBrowser && !win.closed);
}

function openTabs(win) {
  return win.gBrowser.tabs.filter(tab => !tab.closing);
}

function cleanUp() {
  const { tabCleanup, cleanupHours } = NyxTheme.settings;
  if (!tabCleanup) return;
  const cutoff = Date.now() - cleanupHours * HOUR_MS;
  for (const win of browserWindows()) {
    const { gBrowser } = win;
    const stale = openTabs(win).filter(tab =>
      !tab.pinned && !tab.selected && !tab.soundPlaying && tab.lastAccessed < cutoff
    );
    // Closed this way they stay in "recently closed", so ⌘⇧T brings them back.
    if (stale.length) gBrowser.removeTabs(stale, { animate: false });
  }
}

function checkCount(win) {
  const { tabWarning, tabLimit } = NyxTheme.settings;
  const box = win.gNotificationBox;
  const tooMany = tabWarning && openTabs(win).length > tabLimit;
  if (!tooMany) {
    warned.delete(win);
    box.getNotificationWithValue(WARNING_ID)?.close();
    return;
  }
  if (warned.has(win)) return;
  warned.add(win);
  box.appendNotification(
    WARNING_ID,
    { label: `Вкладок больше ${tabLimit}. Лишние можно закрыть в сотах.`, priority: box.PRIORITY_INFO_MEDIUM },
    [
      {
        label: "Открыть соты",
        callback: () => win.document.getElementById("key_nyxHive")?.doCommand(),
      },
      { label: "Скрыть", callback: () => {} },
    ]
  );
}

export const NyxTabs = {
  // Called once per browser window.
  watch(win) {
    const onChange = () => checkCount(win);
    for (const name of ["TabOpen", "TabClose"]) win.gBrowser.tabContainer.addEventListener(name, onChange);
    checkCount(win);
    if (!timer) {
      timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(cleanUp, CHECK_EVERY_MS, Ci.nsITimer.TYPE_REPEATING_SLACK);
    }
  },

  // Settings changed: re-check the warning in every window.
  refresh() {
    for (const win of browserWindows()) {
      warned.delete(win);
      checkCount(win);
    }
    cleanUp();
  },
};
