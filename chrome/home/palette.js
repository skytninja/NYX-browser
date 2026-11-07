"use strict";

// ⌘K: one field for open tabs, commands, spaces, history and bookmarks, addresses and search.
const browserWindow = window.top;
const { gBrowser } = browserWindow;
const { NyxTheme, PRESETS } = ChromeUtils.importESModule("chrome://nyx/content/NyxTheme.sys.mjs");
const { NyxSpaces } = ChromeUtils.importESModule("chrome://nyx/content/NyxSpaces.sys.mjs");
const { NyxFocus } = ChromeUtils.importESModule("chrome://nyx/content/NyxFocus.sys.mjs");
const { NyxSnooze, snoozeChoices } = ChromeUtils.importESModule("chrome://nyx/content/NyxSnooze.sys.mjs");
const { tabUrl } = ChromeUtils.importESModule("chrome://nyx/content/NyxTabs.sys.mjs");
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");

const MAX_TABS = 6;
const MAX_PLACES = 6;
const MAX_RESULTS = 14;
const WEB_URL = /^https?:\/\//;
const SYSTEM = Services.scriptSecurityManager.getSystemPrincipal();

const input = document.getElementById("query");
const list = document.getElementById("results");
let results = [];
let selected = 0;
let generation = 0;
let closing = false;

function close() {
  if (closing) return;
  closing = true;
  browserWindow.focus();
  gBrowser.selectedBrowser.focus();
  window.frameElement.remove();
}

// The palette hides at once but stays in the page until the action finishes:
// code waiting inside a removed frame would never get to continue.
let running = false;
async function runAndClose(action) {
  if (running || closing) return;
  running = true;
  document.body.hidden = true;
  try {
    await action();
  } catch (error) {
    console.error("NYX palette:", error);
  }
  close();
}

const openUrl = url => browserWindow.openTrustedLinkIn(url, "tab");
const hiveKey = () => browserWindow.document.getElementById("key_nyxHive");

const normalize = text => text.toLowerCase().replaceAll("ё", "е").trim();

// Every word of the query has to appear somewhere. A match at the start of the text ranks higher.
function score(query, ...texts) {
  const haystack = normalize(texts.filter(Boolean).join(" "));
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let total = 0;
  for (const word of words) {
    const at = haystack.indexOf(word);
    if (at < 0) return 0;
    total += at === 0 ? 3 : /[\s/.:-]/.test(haystack[at - 1]) ? 2 : 1;
  }
  return total;
}

function commands() {
  const settings = NyxTheme.settings;
  const current = gBrowser.selectedTab;
  const items = [
    // The hive opens only once the palette frame is gone. Right after close(), in the same call:
    // a timer or promise started in the removed frame never runs.
    { title: "Соты", keys: "hive overview обзор вкладки",
      run: () => {
        close();
        hiveKey()?.doCommand();
      } },
    { title: "Новая вкладка", keys: "new tab", run: () => openUrl(browserWindow.BROWSER_NEW_TAB_URL) },
    { title: "Кастомизация", keys: "settings настройки тема цвета customize",
      run: () => openUrl("chrome://nyx/content/customize.html") },
    { title: "Пароли", keys: "passwords logins логины импорт", run: () => openUrl("about:logins") },
    { title: "Настройки браузера", keys: "preferences settings", run: () => openUrl("about:preferences") },
    NyxFocus.manualUntil
      ? { title: "Выключить фокус", keys: "focus off", run: () => NyxFocus.stopManual() }
      : { title: "Фокус на час", keys: "focus mode фокус-режим", run: () => NyxFocus.forAnHour() },
    settings.tabs === "top"
      ? { title: "Вкладки слева", keys: "vertical tabs left сайдбар", run: () => NyxTheme.update({ tabs: "left" }) }
      : { title: "Вкладки сверху", keys: "horizontal tabs top", run: () => NyxTheme.update({ tabs: "top" }) },
    ...Object.entries(PRESETS)
      .filter(([name]) => name !== settings.preset)
      .map(([name, preset]) => ({ title: `Тема: ${preset.label}`, keys: "theme тема цвет", run: () => NyxTheme.usePreset(name) })),
    { title: "Новое временное пространство", keys: "temporary incognito инкогнито временное",
      run: async () => NyxSpaces.open((await NyxSpaces.createTemporary()).id) },
  ];
  const url = tabUrl(browserWindow, current);
  if (WEB_URL.test(url ?? "") && !current.pinned) {
    const [, tomorrow] = snoozeChoices();
    items.push({ title: "Отложить вкладку до завтра", keys: "snooze later потом",
      run: async () => {
        await NyxSnooze.add({ url, title: current.label }, tomorrow.until);
        gBrowser.removeTab(current);
      } });
  }
  return items.map(item => ({ ...item, group: "Команды" }));
}

// "Закрыть всё с youtube.com": offered for sites of open tabs that match the query.
function closeSiteCommands(query) {
  if (normalize(query).length < 2) return [];
  const bySite = new Map();
  for (const tab of gBrowser.tabs) {
    if (tab.pinned) continue;
    let host = "";
    try {
      host = new URL(tabUrl(browserWindow, tab)).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (host) bySite.set(host, [...(bySite.get(host) ?? []), tab]);
  }
  return [...bySite]
    .filter(([host]) => score(query.replace(/^(закрыть|close)\s*/i, ""), host))
    .map(([host, tabs]) => ({
      group: "Команды",
      title: `Закрыть всё с ${host}`,
      detail: `${tabs.length} ${tabs.length === 1 ? "вкладка" : "вкладки"}`,
      keys: `close закрыть ${host}`,
      // Never picked by a bare Enter.
      destructive: true,
      run: () => gBrowser.removeTabs(tabs.filter(tab => !tab.closing)),
    }));
}

function tabResults(query) {
  return gBrowser.tabs
    .filter(tab => !tab.closing && tab !== gBrowser.selectedTab)
    .map(tab => ({ tab, url: tabUrl(browserWindow, tab) ?? "", rank: score(query, tab.label, tabUrl(browserWindow, tab)) }))
    .filter(item => item.rank)
    // With an empty query: most recently used first.
    .sort((a, b) => b.rank - a.rank || b.tab.lastAccessed - a.tab.lastAccessed)
    .slice(0, MAX_TABS)
    .map(({ tab, url }) => ({
      group: "Вкладки",
      title: tab.label,
      detail: url.replace(/^https?:\/\/(www\.)?/, ""),
      icon: gBrowser.getIcon(tab),
      run: () => {
        gBrowser.selectedTab = tab;
      },
    }));
}

async function spaceResults(query) {
  const current = NyxSpaces.currentId;
  return (await NyxSpaces.list())
    .filter(space => space.id !== current)
    .map((space, index) => ({ space, index }))
    .filter(({ space }) => score(query, `пространство space ${space.name}`))
    .map(({ space }) => ({
      group: "Пространства",
      title: space.name,
      detail: "открыть пространство",
      run: () => NyxSpaces.open(space.id),
    }));
}

// History and bookmarks, best known first. Parameters keep the query out of the SQL text.
// AUTOCOMPLETE_MATCH is the address bar's own matcher: every word anywhere, any case in any
// language, ё same as е. SQLite's LIKE ignores case only for Latin letters. Its last flag says
// what a page must be: visited, or bookmarked for bookmarks never opened.
async function placeResults(query) {
  if (normalize(query).length < 2) return [];
  const db = await PlacesUtils.promiseDBConnection();
  const rows = await db.executeCached(
    `SELECT url, title, bookmarked FROM (
       -- A bookmark's own name first: a page never opened has no title of its own.
       SELECT h.url, IFNULL((SELECT b.title FROM moz_bookmarks b WHERE b.fk = h.id AND b.title <> '' LIMIT 1), h.title) AS title,
              h.visit_count, h.typed, h.frecency,
              EXISTS (SELECT 1 FROM moz_bookmarks b WHERE b.fk = h.id) AS bookmarked
       FROM moz_places h
       WHERE h.hidden = 0 AND (substr(h.url, 1, 8) = 'https://' OR substr(h.url, 1, 7) = 'http://')
     )
     WHERE AUTOCOMPLETE_MATCH(:query, url, title, NULL, visit_count, typed, bookmarked, 0, :matchBehavior,
                              CASE WHEN bookmarked THEN :bookmarkBehavior ELSE :historyBehavior END, NULL)
     ORDER BY bookmarked DESC, frecency DESC
     LIMIT :limit`,
    {
      query: query.trim(),
      matchBehavior: Ci.mozIPlacesAutoComplete.MATCH_ANYWHERE,
      bookmarkBehavior: Ci.mozIPlacesAutoComplete.BEHAVIOR_BOOKMARK,
      historyBehavior: Ci.mozIPlacesAutoComplete.BEHAVIOR_HISTORY,
      limit: MAX_PLACES * 2,
    }
  );
  const open = new Set(gBrowser.tabs.map(tab => tabUrl(browserWindow, tab)));
  return rows
    .map(row => ({ url: row.getResultByName("url"), title: row.getResultByName("title"), bookmarked: row.getResultByName("bookmarked") }))
    .filter(row => WEB_URL.test(row.url) && !open.has(row.url))
    .slice(0, MAX_PLACES)
    .map(row => ({
      group: row.bookmarked ? "Закладки" : "История",
      title: row.title || row.url,
      detail: row.url.replace(/^https?:\/\/(www\.)?/, ""),
      icon: `page-icon:${row.url}`,
      run: () => openUrl(row.url),
    }));
}

// "site.com/page" or a full http(s) link: offered as an address to open.
function addressOf(query) {
  const text = query.trim();
  if (!text || /\s/.test(text)) return null;
  const candidate = WEB_URL.test(text) ? text : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text) ? `https://${text}` : null;
  if (!candidate) return null;
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

function searchResult(query) {
  const text = query.trim();
  if (!text) return [];
  const address = addressOf(text);
  const items = [];
  if (address) items.push({ group: "Адрес", title: address, detail: "открыть", run: () => openUrl(address) });
  items.push({
    group: "Поиск",
    title: text,
    detail: "искать в DuckDuckGo",
    run: async () => {
      const engine = await SearchService.getDefault();
      openUrl(engine.getSubmission(text).uri.spec);
    },
  });
  return items;
}

function rankedCommands(query) {
  const items = [...commands(), ...closeSiteCommands(query)];
  if (!query.trim()) return items.slice(0, 6);
  return items
    .map(item => ({ item, rank: score(query, item.title, item.keys) }))
    .filter(entry => entry.rank)
    .sort((a, b) => b.rank - a.rank)
    .map(entry => entry.item);
}

async function update() {
  const query = input.value;
  const run = ++generation;
  const quick = [...tabResults(query), ...rankedCommands(query), ...(await spaceResults(query))];
  let places = [];
  try {
    places = await placeResults(query);
  } catch (error) {
    console.error("NYX palette: history unavailable", error);
  }
  // A newer keystroke already started its own search.
  if (run !== generation) return;
  results = [...quick, ...places, ...searchResult(query)].slice(0, MAX_RESULTS);
  // With text typed, a direct address beats everything else.
  const address = results.findIndex(result => result.group === "Адрес");
  selected = address >= 0 && !quick.some(result => result.group === "Вкладки") ? address : 0;
  if (results[selected]?.destructive) selected = Math.max(0, results.findIndex(result => !result.destructive));
  render();
}

function render() {
  const rows = [];
  let lastGroup = null;
  results.forEach((result, index) => {
    if (result.group !== lastGroup) {
      lastGroup = result.group;
      const heading = document.createElement("li");
      heading.className = "group";
      heading.setAttribute("role", "presentation");
      heading.textContent = result.group;
      rows.push(heading);
    }
    const row = document.createElement("li");
    row.className = "result";
    row.id = `result-${index}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === selected));
    const icon = document.createElement("span");
    icon.className = "icon";
    if (result.icon) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = result.icon;
      image.addEventListener("error", () => image.remove());
      icon.append(image);
    }
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = result.title;
    row.append(icon, title);
    if (result.detail) {
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = result.detail;
      row.append(detail);
    }
    row.addEventListener("pointermove", () => select(index));
    row.addEventListener("click", () => runAndClose(result.run));
    rows.push(row);
  });
  list.replaceChildren(...rows);
  input.setAttribute("aria-activedescendant", results.length ? `result-${selected}` : "");
}

function select(index) {
  if (index === selected || !results.length) return;
  selected = (index + results.length) % results.length;
  for (const row of list.querySelectorAll(".result")) {
    row.setAttribute("aria-selected", String(row.id === `result-${selected}`));
  }
  input.setAttribute("aria-activedescendant", `result-${selected}`);
  document.getElementById(`result-${selected}`)?.scrollIntoView({ block: "nearest" });
}

input.addEventListener("input", () => update().catch(console.error));
addEventListener("keydown", event => {
  // "Accel" is ⌘ on macOS and Ctrl on Windows.
  if (event.key === "Escape" || (event.getModifierState("Accel") && event.code === "KeyK")) {
    event.preventDefault();
    close();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    select(selected + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Enter" && results[selected]) {
    event.preventDefault();
    runAndClose(results[selected].run);
  }
});
document.getElementById("backdrop").addEventListener("click", close);
// Clicking anywhere in the browser outside the palette closes it. Only once it really had focus:
// opened in a window that isn't active, it would otherwise close the moment it appears.
let hadFocus = false;
addEventListener("focus", () => {
  hadFocus = true;
}, true);
addEventListener("blur", () => setTimeout(() => {
  if (hadFocus && !running && !document.hasFocus()) close();
}, 0));

input.focus();
update().catch(console.error);
