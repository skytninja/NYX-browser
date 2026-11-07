// Tab housekeeping, checked every minute: sleep, auto-cleanup, snoozed tabs coming back,
// the "too many tabs" warning and focus mode's hard limit. Settings live in NyxTheme (nyx-theme.json).

import { NyxTheme } from "chrome://nyx/content/NyxTheme.sys.mjs";
import { NyxTrash } from "chrome://nyx/content/NyxTrash.sys.mjs";
import { NyxSnooze } from "chrome://nyx/content/NyxSnooze.sys.mjs";
import { NyxFocus } from "chrome://nyx/content/NyxFocus.sys.mjs";

const CHECK_EVERY_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const WARNING_ID = "nyx-too-many-tabs";
const LIMIT_ID = "nyx-focus-limit";
const SNOOZE_ID = "nyx-snooze-back";

const warned = new WeakSet();
let timer = null;

function browserWindows() {
  return [...Services.wm.getEnumerator("navigator:browser")].filter(win => win.gBrowser && !win.closed);
}

function openTabs(win) {
  return win.gBrowser.tabs.filter(tab => !tab.closing);
}

// In use even unseen: playing sound, in Picture-in-Picture, or sharing camera, mic or screen.
// The same tabs Firefox's own unloader never touches.
function busy(tab) {
  if (tab.soundPlaying || tab.pictureinpicture || tab.undiscardable) return true;
  const { webrtcUI } = ChromeUtils.importESModule("resource:///modules/webrtcUI.sys.mjs");
  const browser = tab.linkedBrowser;
  return webrtcUI.browserHasStreams(browser) || !!browser.browsingContext?.currentWindowGlobal?.hasActivePeerConnections();
}

// A tab that was never loaded after a restart only knows its address in the session.
export function tabUrl(win, tab) {
  const url = tab.linkedBrowser.currentURI?.spec;
  return url && url !== "about:blank" ? url : win.SessionStore.getLazyTabValue(tab, "url");
}

// Asleep: unloaded from memory but still in its place. Opening it loads the page again.
function putToSleep() {
  const { tabSleep, sleepMinutes } = NyxTheme.settings;
  if (!tabSleep) return;
  const cutoff = Date.now() - sleepMinutes * MINUTE_MS;
  for (const win of browserWindows()) {
    for (const tab of openTabs(win)) {
      // Pinned tabs stay awake: they're usually mail and chats that should keep notifying.
      if (tab.pinned || tab.selected || tab.hasAttribute("pending") || tab.lastAccessed >= cutoff || busy(tab)) continue;
      win.gBrowser.discardBrowser(tab);
    }
  }
}

function cleanUp() {
  const { tabCleanup, cleanupHours } = NyxTheme.settings;
  if (!tabCleanup) return;
  const cutoff = Date.now() - cleanupHours * HOUR_MS;
  for (const win of browserWindows()) {
    const { gBrowser } = win;
    const stale = openTabs(win).filter(tab =>
      !tab.pinned && !tab.selected && tab.lastAccessed < cutoff && !busy(tab)
    );
    if (!stale.length) continue;
    NyxTrash.add(stale.map(tab => ({ url: tabUrl(win, tab), title: tab.label })))
      .catch(error => console.error("NYX: can't fill the trash", error));
    // Closed this way they also stay in "recently closed", so ⌘⇧T brings them back.
    gBrowser.removeTabs(stale, { animate: false });
  }
}

async function bringBackSnoozed() {
  // Without a window (macOS keeps running with all of them closed) the tabs wait in the list.
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (!win) return;
  const ready = await NyxSnooze.due();
  if (!ready.length || win.closed) {
    if (ready.length) await Promise.all(ready.map(item => NyxSnooze.add(item, item.until)));
    return;
  }
  for (const item of ready) win.openTrustedLinkIn(item.url, "tabshifted");
  const box = win.gNotificationBox;
  box.getNotificationWithValue(SNOOZE_ID)?.close();
  const label = ready.length === 1 ? `Вернулась отложенная вкладка: ${ready[0].title}` : `Вернулись отложенные вкладки: ${ready.length}`;
  box.appendNotification(SNOOZE_ID, { label, priority: box.PRIORITY_INFO_LOW }, []);
}

function tick() {
  putToSleep();
  cleanUp();
  bringBackSnoozed().catch(error => console.error("NYX: snoozed tabs", error));
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

// Focus with the hard limit: a tab opened over the limit closes at once.
function enforceLimit(win, tab) {
  const { focusHardLimit, tabLimit } = NyxTheme.settings;
  if (!focusHardLimit || tab.pinned || !NyxFocus.active || openTabs(win).length <= tabLimit) return;
  // After the tab finished opening, so the browser isn't mid-way through its own setup.
  win.setTimeout(() => {
    if (tab.closing || !tab.isConnected) return;
    win.gBrowser.removeTab(tab, { animate: false });
    const box = win.gNotificationBox;
    if (box.getNotificationWithValue(LIMIT_ID)) return;
    box.appendNotification(
      LIMIT_ID,
      { label: `Фокус: не больше ${tabLimit} вкладок. Закрой лишние, чтобы открыть новую.`, priority: box.PRIORITY_WARNING_LOW },
      [{ label: "Открыть соты", callback: () => win.document.getElementById("key_nyxHive")?.doCommand() }]
    );
  }, 0);
}

export const NyxTabs = {
  // Called once per browser window.
  watch(win) {
    const onChange = () => checkCount(win);
    for (const name of ["TabOpen", "TabClose"]) win.gBrowser.tabContainer.addEventListener(name, onChange);
    // Restored tabs are not new tabs: the limit only counts once the session is back.
    win.SessionStore.promiseAllWindowsRestored.then(() => {
      win.gBrowser.tabContainer.addEventListener("TabOpen", event => enforceLimit(win, event.target));
    });
    checkCount(win);
    NyxFocus.start();
    if (!timer) {
      timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(tick, CHECK_EVERY_MS, Ci.nsITimer.TYPE_REPEATING_SLACK);
    }
  },

  // Settings changed: re-check the warning in every window.
  refresh() {
    for (const win of browserWindows()) {
      warned.delete(win);
      checkCount(win);
    }
    tick();
  },
};
