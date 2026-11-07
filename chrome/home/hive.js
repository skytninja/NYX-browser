"use strict";

// Tab overview: every tab is a hexagon on an endless pannable field.
const browserWindow = window.top;
const { gBrowser, SessionStore } = browserWindow;

const HEX_WIDTH = 240;
const HEX_HEIGHT = 277;
const GAP = 12;
const STEP_X = HEX_WIDTH + GAP;
const STEP_Y = HEX_HEIGHT * 0.75 + GAP;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2;
const DRAG_THRESHOLD = 5;
const KEY_ZOOM = 1.2;
const SHOT_WIDTH = 480;
const SHOT_CONCURRENCY = 3;
const CLOSE_DELAY_MS = 220;
const POSITION_KEY = "nyx-hive";
const IS_WINDOWS = Services.appinfo.OS === "WINNT";
// The key that opened the overview also closes it: ⌥Tab on macOS, Ctrl+Space on Windows.
const isHiveKey = event => IS_WINDOWS ? event.ctrlKey && event.code === "Space" : event.altKey && event.key === "Tab";
const HEAVY_BYTES = 500 * 1024 * 1024;
const { tabUrl } = ChromeUtils.importESModule("chrome://nyx/content/NyxTabs.sys.mjs");
const { NyxSnooze, snoozeChoices } = ChromeUtils.importESModule("chrome://nyx/content/NyxSnooze.sys.mjs");
const TAB_EVENTS = ["TabOpen", "TabClose", "TabPinned", "TabUnpinned", "TabAttrModified",
  "TabGrouped", "TabUngrouped", "TabGroupUpdate", "TabGroupRemoved"];
// Firefox's own tab group colors, so groups look the same here and in the tab strip.
const GROUP_COLORS = {
  blue: "#4a90ff", purple: "#b07cff", cyan: "#3fd6e8", orange: "#ff9a3c", yellow: "#ffd23f",
  pink: "#ff6fb5", green: "#4cd07a", gray: "#9a9a9a", red: "#ff5f57",
};
// Walks a ring's six edges, starting from its (-radius, radius) corner.
const RING_DIRECTIONS = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
const KEY_MOVES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const viewport = document.getElementById("viewport");
const world = document.getElementById("world");
const view = { x: 0, y: 0, scale: 1 };
const positions = new Map(); // tab -> { q, r }
const tiles = new Map(); // tab -> tile element
const shotsTaken = new WeakSet();
let closing = false;
let frameRequest = 0;

const hexKey = ({ q, r }) => `${q},${r}`;
const hexCenter = ({ q, r }) => ({ x: STEP_X * (q + r / 2), y: STEP_Y * r });

function worldToHex(x, y) {
  const fractionR = y / STEP_Y;
  const fractionQ = x / STEP_X - fractionR / 2;
  const fractionS = -fractionQ - fractionR;
  let q = Math.round(fractionQ);
  let r = Math.round(fractionR);
  const s = Math.round(fractionS);
  const dq = Math.abs(q - fractionQ);
  const dr = Math.abs(r - fractionR);
  const ds = Math.abs(s - fractionS);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

// Center first, then outward ring by ring.
function* spiral() {
  yield { q: 0, r: 0 };
  for (let radius = 1; ; radius++) {
    let q = -radius;
    let r = radius;
    for (const [dq, dr] of RING_DIRECTIONS) {
      for (let i = 0; i < radius; i++) {
        q += dq;
        r += dr;
        yield { q, r };
      }
    }
  }
}

function firstFreeHex(taken) {
  for (const hex of spiral()) {
    if (!taken.has(hexKey(hex))) return hex;
  }
  throw new Error("unreachable: the spiral is endless");
}

function readSavedPosition(tab) {
  const match = /^(-?\d+),(-?\d+)$/.exec(SessionStore.getCustomTabValue(tab, POSITION_KEY) || "");
  return match ? { q: Number(match[1]), r: Number(match[2]) } : null;
}

function savePosition(tab, hex) {
  positions.set(tab, hex);
  SessionStore.setCustomTabValue(tab, POSITION_KEY, hexKey(hex));
}

function currentTabs() {
  return gBrowser.tabs.filter(tab => !tab.closing);
}

function assignPositions() {
  const tabs = currentTabs();
  for (const tab of positions.keys()) {
    if (!tabs.includes(tab)) positions.delete(tab);
  }
  const taken = new Set([...positions.values()].map(hexKey));
  for (const tab of tabs) {
    if (positions.has(tab)) continue;
    const saved = readSavedPosition(tab);
    const hex = saved && !taken.has(hexKey(saved)) ? saved : firstFreeHex(taken);
    taken.add(hexKey(hex));
    savePosition(tab, hex);
  }
  return taken;
}

function placeTile(tile, hex) {
  const { x, y } = hexCenter(hex);
  tile.style.left = `${x - HEX_WIDTH / 2}px`;
  tile.style.top = `${y - HEX_HEIGHT / 2}px`;
}

function applyView() {
  frameRequest = 0;
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function requestViewUpdate() {
  frameRequest ||= requestAnimationFrame(applyView);
}

function centerOn(hex) {
  const { x, y } = hexCenter(hex);
  view.x = innerWidth / 2 - x * view.scale;
  view.y = innerHeight / 2 - y * view.scale;
  requestViewUpdate();
}

function zoomAt(clientX, clientY, factor) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  view.x = clientX - (clientX - view.x) * ratio;
  view.y = clientY - (clientY - view.y) * ratio;
  view.scale = scale;
  requestViewUpdate();
}

function clientToWorld(clientX, clientY) {
  return { x: (clientX - view.x) / view.scale, y: (clientY - view.y) / view.scale };
}

function close(afterClose) {
  if (closing) return;
  closing = true;
  document.body.classList.add("closing");
  setTimeout(() => {
    gBrowser.tabContainer && TAB_EVENTS.forEach(name => gBrowser.tabContainer.removeEventListener(name, render));
    afterClose?.();
    browserWindow.focus();
    gBrowser.selectedBrowser.focus();
    window.frameElement.remove();
  }, CLOSE_DELAY_MS);
}

function openTab(tab) {
  if (closing) return;
  // Fly into the chosen hexagon while the overview fades.
  const hex = positions.get(tab);
  const { x, y } = hexCenter(hex);
  const scale = Math.min(innerWidth / HEX_WIDTH, innerHeight / HEX_HEIGHT);
  view.scale = scale;
  view.x = innerWidth / 2 - x * scale;
  view.y = innerHeight / 2 - y * scale;
  applyView();
  close(() => {
    gBrowser.selectedTab = tab;
  });
}

function openNewTab() {
  close(() => {
    const tab = gBrowser.addTab(browserWindow.BROWSER_NEW_TAB_URL, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.selectedTab = tab;
  });
}

function fillTileText(tile, tab) {
  tile.querySelector(".tile-title").textContent = tab.label;
  tile.querySelector(".tile-open").setAttribute("aria-label", tab.label);
  tile.classList.toggle("active", tab === gBrowser.selectedTab);
  tile.classList.toggle("asleep", tab.hasAttribute("pending"));
  tile.classList.toggle("picked", picked.has(tab));
  const groupColor = GROUP_COLORS[tab.group?.color];
  tile.classList.toggle("grouped", Boolean(groupColor));
  if (groupColor) tile.style.setProperty("--group", groupColor);
  else tile.style.removeProperty("--group");

  const icon = tile.querySelector(".tile-icon");
  const source = gBrowser.getIcon(tab);
  if (icon.dataset.source === (source || "")) return;
  icon.dataset.source = source || "";
  const showLetter = () => {
    icon.textContent = (tab.label.trim()[0] || "?").toUpperCase();
  };
  icon.replaceChildren();
  if (!source) {
    showLetter();
    return;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.src = source;
  image.addEventListener("error", showLetter);
  icon.append(image);
}

function createTile(tab) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.tabIndex = -1;

  const open = document.createElement("button");
  open.type = "button";
  open.className = "tile-open";

  const shot = document.createElement("canvas");
  shot.className = "tile-shot";

  const info = document.createElement("span");
  info.className = "tile-info";
  const icon = document.createElement("span");
  icon.className = "tile-icon";
  const title = document.createElement("span");
  title.className = "tile-title";
  const memory = document.createElement("span");
  memory.className = "tile-memory";
  info.append(icon, title, memory);
  open.append(shot, info);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "tile-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Закрыть вкладку");
  // Without this the field below captures the pointer and the click never reaches the button.
  closeButton.addEventListener("pointerdown", event => event.stopPropagation());
  closeButton.addEventListener("click", () => closeTab(tab));

  const snoozeButton = document.createElement("button");
  snoozeButton.type = "button";
  snoozeButton.className = "tile-snooze";
  snoozeButton.textContent = "☾";
  snoozeButton.setAttribute("aria-label", "Отложить вкладку");
  snoozeButton.title = "Отложить";
  snoozeButton.addEventListener("pointerdown", event => event.stopPropagation());
  snoozeButton.addEventListener("click", () => askSnooze([tab], `Отложить «${tab.label}»`));

  tile.append(open, closeButton, snoozeButton);
  attachTileDrag(tile, tab);
  open.addEventListener("keydown", event => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      closeTab(tab);
    }
  });
  return tile;
}

// Keeps keyboard focus in the overview so ⌘W can be pressed again and again.
function closeTab(tab) {
  const hadFocus = focusedTab() === tab;
  gBrowser.removeTab(tab, { animate: false });
  if (hadFocus || !document.activeElement?.closest?.(".tile")) {
    tiles.get(gBrowser.selectedTab)?.querySelector(".tile-open").focus({ preventScroll: true });
  }
}

function hoveredTab() {
  return [...tiles].find(([, element]) => element.matches(":hover"))?.[0] ?? null;
}

function createNewTabTile() {
  const tile = document.createElement("div");
  tile.className = "tile tile-new";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "tile-open";
  open.textContent = "+";
  open.setAttribute("aria-label", "Новая вкладка");
  open.addEventListener("click", openNewTab);
  tile.append(open);
  return tile;
}

const newTabTile = createNewTabTile();

function render() {
  if (closing) return;
  const taken = assignPositions();
  const tabs = currentTabs();

  for (const [tab, tile] of tiles) {
    if (!tabs.includes(tab)) {
      tile.remove();
      tiles.delete(tab);
    }
  }
  for (const tab of tabs) {
    let tile = tiles.get(tab);
    if (!tile) {
      tile = createTile(tab);
      tiles.set(tab, tile);
      world.append(tile);
    }
    fillTileText(tile, tab);
    placeTile(tile, positions.get(tab));
  }
  placeTile(newTabTile, firstFreeHex(taken));
  world.append(newTabTile);
  applySearch();
  renderClusters();
  scheduleMemory();
  takeShots();
}

async function drawShot(tab) {
  const browser = tab.linkedBrowser;
  const width = browser.clientWidth;
  const height = browser.clientHeight;
  if (!width || !height || !browser.browsingContext?.currentWindowGlobal) return;
  const bitmap = await browser.drawSnapshot(0, 0, width, height, SHOT_WIDTH / width, "rgb(0,0,0)");
  const canvas = tiles.get(tab)?.querySelector(".tile-shot");
  if (canvas) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    canvas.classList.add("ready");
  }
  bitmap.close();
}

// Tabs that were never loaded have nothing to draw and keep their icon and title.
async function takeShots() {
  const queue = currentTabs().filter(tab => !shotsTaken.has(tab) && !tab.hasAttribute("pending"));
  queue.forEach(tab => shotsTaken.add(tab));
  const worker = async () => {
    for (let tab = queue.shift(); tab && !closing; tab = queue.shift()) {
      try {
        await drawShot(tab);
      } catch (error) {
        // Some pages refuse snapshots while busy. The tile still works without a picture.
        console.warn("NYX hive: no snapshot for", tab.label, error);
      }
    }
  };
  await Promise.all(Array.from({ length: SHOT_CONCURRENCY }, worker));
}

function attachTileDrag(tile, tab) {
  let start = null;
  let dragging = false;

  tile.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest(".tile-close, .tile-snooze")) return;
    event.stopPropagation();
    start = { x: event.clientX, y: event.clientY };
    dragging = false;
    tile.setPointerCapture(event.pointerId);
  });

  tile.addEventListener("pointermove", event => {
    if (!start) return;
    if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
    dragging = true;
    tile.classList.add("dragging");
    const point = clientToWorld(event.clientX, event.clientY);
    tile.style.left = `${point.x - HEX_WIDTH / 2}px`;
    tile.style.top = `${point.y - HEX_HEIGHT / 2}px`;
  });

  const finish = event => {
    if (!start) return;
    start = null;
    if (!dragging) {
      if (event.type === "pointerup") {
        if (event.shiftKey) togglePick(tab);
        else openTab(tab);
      }
      return;
    }
    dragging = false;
    tile.classList.remove("dragging");
    if (event.type === "pointerup") {
      const point = clientToWorld(event.clientX, event.clientY);
      moveTabTo(tab, worldToHex(point.x, point.y));
    }
    render();
  };
  tile.addEventListener("pointerup", finish);
  tile.addEventListener("pointercancel", finish);
}

// Dropping on another tab swaps the two.
function moveTabTo(tab, hex) {
  const target = hexKey(hex);
  const previous = positions.get(tab);
  for (const [other, position] of positions) {
    if (other !== tab && hexKey(position) === target) savePosition(other, previous);
  }
  savePosition(tab, hex);
}

function panBy(dx, dy) {
  view.x += dx;
  view.y += dy;
  requestViewUpdate();
}

function setupViewportInput() {
  let panStart = null;

  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    panStart = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("panning");
  });
  viewport.addEventListener("pointermove", event => {
    if (!panStart) return;
    view.x = panStart.viewX + event.clientX - panStart.x;
    view.y = panStart.viewY + event.clientY - panStart.y;
    requestViewUpdate();
  });
  const endPan = () => {
    panStart = null;
    viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);

  // macOS reports a trackpad pinch as ctrl + wheel.
  viewport.addEventListener("wheel", event => {
    event.preventDefault();
    if (event.ctrlKey) {
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01));
    } else {
      panBy(-event.deltaX, -event.deltaY);
    }
  }, { passive: false });
}

function focusedTab() {
  const tile = document.activeElement?.closest?.(".tile");
  return [...tiles].find(([, element]) => element === tile)?.[0] ?? null;
}

function focusTab(tab) {
  tiles.get(tab)?.querySelector(".tile-open").focus({ preventScroll: true });
  centerOn(positions.get(tab));
}

// Picks the nearest tab in the pressed direction, however far the next one is.
function moveFocus(dq, dr) {
  const current = focusedTab() ?? gBrowser.selectedTab;
  const origin = hexCenter(positions.get(current));
  const direction = hexCenter({ q: dq, r: dr });
  let best = null;
  let bestDistance = Infinity;
  for (const [tab, hex] of positions) {
    if (tab === current) continue;
    const { x, y } = hexCenter(hex);
    const dx = x - origin.x;
    const dy = y - origin.y;
    const distance = Math.hypot(dx, dy);
    if ((dx * direction.x + dy * direction.y) / (distance * Math.hypot(direction.x, direction.y)) < 0.5) continue;
    if (distance < bestDistance) {
      best = tab;
      bestDistance = distance;
    }
  }
  if (best) focusTab(best);
}

// Memory of each tab's process. Tabs of one site share a process, so they split its memory.
const formatMegabytes = bytes => `${Math.max(1, Math.round(bytes / 1024 / 1024))} МБ`;

async function showMemory() {
  const info = await ChromeUtils.requestProcInfo();
  const memoryByPid = new Map(info.children.map(child => [child.pid, child.memory]));
  const pidOf = tab => tab.linkedBrowser.browsingContext?.currentWindowGlobal?.osPid;
  const tabsByPid = new Map();
  for (const tab of tiles.keys()) {
    const pid = pidOf(tab);
    if (memoryByPid.has(pid)) tabsByPid.set(pid, (tabsByPid.get(pid) ?? 0) + 1);
  }
  for (const [tab, tile] of tiles) {
    const badge = tile.querySelector(".tile-memory");
    const pid = pidOf(tab);
    if (tab.hasAttribute("pending")) {
      badge.textContent = "спит";
      badge.title = "Выгружена из памяти. Загрузится, когда откроешь.";
      tile.classList.remove("heavy");
    } else if (memoryByPid.has(pid)) {
      const shared = tabsByPid.get(pid);
      const bytes = memoryByPid.get(pid) / shared;
      badge.textContent = `≈ ${formatMegabytes(bytes)}`;
      badge.title = shared > 1 ? `Процесс сайта на ${shared} вкладки: ${formatMegabytes(memoryByPid.get(pid))}` : "";
      tile.classList.toggle("heavy", bytes >= HEAVY_BYTES);
    } else {
      // Browser pages (home, settings) live in the main process.
      badge.textContent = "";
      tile.classList.remove("heavy");
    }
  }
}

// Pages report changes many times while loading: measure at most every couple of seconds.
let memoryTimer = 0;
function scheduleMemory() {
  memoryTimer ||= setTimeout(() => {
    memoryTimer = 0;
    if (!closing) showMemory().catch(console.error);
  }, 300);
}

// A small dialog in the middle of the overview: snoozing, group actions.
const dialog = document.getElementById("snooze");

function closeDialog() {
  dialog.hidden = true;
  dialog.replaceChildren();
}

function showDialog(headingText, buttons) {
  const heading = document.createElement("p");
  heading.className = "snooze-title";
  heading.textContent = headingText;
  dialog.replaceChildren(heading, ...buttons, spaceButton("Отмена", "space-action snooze-choice", closeDialog));
  dialog.hidden = false;
  dialog.querySelector("button").focus();
  return heading;
}

// Snooze: the tabs close now and come back by themselves at the chosen time. Only sites can.
function askSnooze(tabs, title) {
  const webTabs = tabs.filter(tab => /^https?:\/\//.test(tabUrl(browserWindow, tab) ?? ""));
  if (!webTabs.length) {
    showDialog(title, [Object.assign(document.createElement("p"), { className: "snooze-note", textContent: "Отложить можно только сайты." })]);
    return;
  }
  const heading = showDialog(title, snoozeChoices().map(({ label, until }) =>
    spaceButton(label, "space-action snooze-choice", async () => {
      try {
        for (const tab of webTabs) await NyxSnooze.add({ url: tabUrl(browserWindow, tab), title: tab.label }, until);
        closeDialog();
        if (webTabs.length === 1) closeTab(webTabs[0]);
        else gBrowser.removeTabs(webTabs, { animate: false });
        renderSide().catch(console.error);
      } catch (error) {
        console.error("NYX: can't snooze", error);
        heading.textContent = "Не получилось отложить.";
      }
    })
  ));
}

// Clusters: Firefox tab groups, shown as colored hexagons with a label above them.
// ⇧-click picks tiles, the bar at the bottom turns the picked ones into a group.
const picked = new Set();
const groupBar = document.getElementById("group-bar");
const clusterLabels = new Map(); // group -> label element
let groupColor = "blue";

function togglePick(tab) {
  if (tab.pinned) return;
  if (picked.has(tab)) picked.delete(tab);
  else picked.add(tab);
  render();
  renderGroupBar();
}

function clearPicks() {
  picked.clear();
  render();
  renderGroupBar();
}

// Pulls the tabs next to the first one. Hexes taken by other tabs are skipped, never stolen.
function gather(tabs) {
  if (tabs.length < 2) return;
  const members = new Set(tabs);
  const anchor = positions.get(tabs[0]);
  const owner = new Map([...positions].map(([tab, hex]) => [hexKey(hex), tab]));
  const targets = [];
  for (const offset of spiral()) {
    const hex = { q: anchor.q + offset.q, r: anchor.r + offset.r };
    const who = owner.get(hexKey(hex));
    if (!who || members.has(who)) targets.push(hex);
    if (targets.length === tabs.length) break;
  }
  const targetKeys = new Set(targets.map(hexKey));
  const staying = new Set(tabs.filter(tab => targetKeys.has(hexKey(positions.get(tab)))));
  const taken = new Set([...staying].map(tab => hexKey(positions.get(tab))));
  const free = targets.filter(hex => !taken.has(hexKey(hex)));
  tabs.filter(tab => !staying.has(tab)).forEach((tab, index) => savePosition(tab, free[index]));
}

function createGroup(label) {
  const tabs = currentTabs().filter(tab => picked.has(tab) && !tab.pinned);
  if (!tabs.length) return;
  const group = gBrowser.addTabGroup(tabs, { label, color: groupColor, insertBefore: tabs[0] });
  if (group) {
    // Set again in case this Firefox ignores the options.
    group.label = label;
    group.color = groupColor;
  }
  picked.clear();
  gather(tabs);
  render();
  renderGroupBar();
}

function renderGroupBar() {
  if (!picked.size) {
    groupBar.hidden = true;
    groupBar.replaceChildren();
    hint.hidden = !searchInput.hidden;
    return;
  }
  hint.hidden = true;
  groupBar.hidden = false;
  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = `Выбрано: ${picked.size}`;
  const name = document.createElement("input");
  name.className = "space-input";
  name.maxLength = 40;
  name.placeholder = "Название группы";
  name.setAttribute("aria-label", "Название группы");
  name.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter") createGroup(name.value.trim());
    if (event.key === "Escape") clearPicks();
  });
  const colors = Object.entries(GROUP_COLORS).map(([key, value]) => {
    const swatch = spaceButton("", "space-swatch", () => {
      groupColor = key;
      for (const each of groupBar.querySelectorAll(".space-swatch")) each.setAttribute("aria-pressed", String(each === swatch));
    }, `Цвет группы: ${key}`);
    swatch.style.setProperty("--swatch", value);
    swatch.setAttribute("aria-pressed", String(key === groupColor));
    return swatch;
  });
  groupBar.replaceChildren(count, name, ...colors,
    spaceButton("Сгруппировать", "space-action", () => createGroup(name.value.trim())),
    spaceButton("Отмена", "space-action", clearPicks));
}

function clusterActions(group) {
  const tabs = group.tabs.filter(tab => tiles.has(tab));
  const title = group.label || "Группа без названия";
  showDialog(`«${title}» · ${tabs.length}`, [
    spaceButton("Собрать рядом", "space-action snooze-choice", () => {
      closeDialog();
      gather(tabs);
      render();
    }),
    spaceButton("Отложить группу", "space-action snooze-choice", () => askSnooze(tabs, `Отложить «${title}»`)),
    spaceButton("Разгруппировать", "space-action snooze-choice", () => {
      closeDialog();
      group.ungroupTabs();
    }),
    spaceButton("Закрыть группу", "space-action snooze-choice", () => {
      closeDialog();
      // Closed groups come back with ⌘⇧T, like closed tabs.
      gBrowser.removeTabGroup(group);
    }),
  ]);
}

// A label floats above each group, centered over its top row.
function renderClusters() {
  const groups = new Map();
  for (const tab of tiles.keys()) {
    if (tab.group) groups.set(tab.group, [...(groups.get(tab.group) ?? []), tab]);
  }
  for (const [group, label] of clusterLabels) {
    if (!groups.has(group)) {
      label.remove();
      clusterLabels.delete(group);
    }
  }
  for (const [group, tabs] of groups) {
    let label = clusterLabels.get(group);
    if (!label) {
      label = spaceButton("", "cluster-label", () => clusterActions(group));
      label.addEventListener("pointerdown", event => event.stopPropagation());
      clusterLabels.set(group, label);
      world.append(label);
    }
    const centers = tabs.map(tab => hexCenter(positions.get(tab)));
    const top = Math.min(...centers.map(center => center.y));
    const row = centers.filter(center => center.y === top);
    const x = row.reduce((sum, center) => sum + center.x, 0) / row.length;
    label.style.left = `${x}px`;
    label.style.top = `${top - HEX_HEIGHT / 2 - 18}px`;
    label.style.setProperty("--group", GROUP_COLORS[group.color] ?? GROUP_COLORS.gray);
    label.textContent = `${group.label || "Группа"} · ${tabs.length}`;
    label.setAttribute("aria-label", `Группа «${group.label || "без названия"}», действия`);
  }
}

// Spaces bar: switch, create, delete. The browser for another space is its own process.
const { NyxSpaces, SPACE_COLORS } = ChromeUtils.importESModule("chrome://nyx/content/NyxSpaces.sys.mjs");
const spacesBar = document.getElementById("spaces");
const spacesState = { creating: false, confirming: null, coloring: null, error: "" };

function spaceButton(label, className, onClick, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", onClick);
  return button;
}

function setSpacesState(changes) {
  Object.assign(spacesState, changes);
  renderSpaces().catch(console.error);
}

function nameInput() {
  const input = document.createElement("input");
  input.className = "space-input";
  input.maxLength = NyxSpaces.MAX_NAME;
  input.placeholder = "Название";
  input.setAttribute("aria-label", "Название пространства");
  input.addEventListener("keydown", async event => {
    event.stopPropagation();
    if (event.key === "Escape") setSpacesState({ creating: false });
    if (event.key !== "Enter" || !input.value.trim()) return;
    try {
      const space = await NyxSpaces.create(input.value);
      spacesState.creating = false;
      await NyxSpaces.open(space.id);
      close();
    } catch (error) {
      console.error("NYX: can't create space", error);
      setSpacesState({ creating: false, error: "Не получилось создать пространство." });
    }
  });
  input.addEventListener("blur", () => {
    if (!input.value.trim()) setSpacesState({ creating: false });
  });
  return input;
}

function confirmRow(space) {
  const row = document.createElement("span");
  row.className = "space space-confirm";
  row.textContent = `Удалить «${space.name}» со всей историей?`;
  row.append(
    spaceButton("Да", "space-action", async () => {
      const removed = await NyxSpaces.remove(space.id);
      setSpacesState({ confirming: null, error: removed ? "" : `«${space.name}» сейчас открыто. Закрой его и попробуй снова.` });
    }),
    spaceButton("Нет", "space-action", () => setSpacesState({ confirming: null }))
  );
  return row;
}

function colorRow(space) {
  const row = document.createElement("span");
  row.className = "space space-colors";
  const pick = color => async () => {
    try {
      await NyxSpaces.setColor(space.id, color);
      setSpacesState({ coloring: null });
    } catch (error) {
      console.error("NYX: can't set space color", error);
      setSpacesState({ coloring: null, error: "Не получилось сменить цвет." });
    }
  };
  for (const color of SPACE_COLORS) {
    const swatch = spaceButton("", "space-swatch", pick(color), `Цвет ${color}`);
    swatch.style.setProperty("--swatch", color);
    if (color === space.color) swatch.setAttribute("aria-pressed", "true");
    row.append(swatch);
  }
  row.append(
    spaceButton("Без цвета", "space-action", pick(null)),
    spaceButton("Готово", "space-action", () => setSpacesState({ coloring: null }))
  );
  return row;
}

async function renderSpaces() {
  const spaces = await NyxSpaces.list();
  const current = NyxSpaces.currentId;
  const items = spaces.map((space, index) => {
    if (spacesState.confirming === space.id) return confirmRow(space);
    if (spacesState.coloring === space.id) return colorRow(space);
    const item = document.createElement("span");
    item.className = space.temporary ? "space space-temp" : "space";
    // The main space has no color, so its windows never get a strip.
    if (space.id !== "default") {
      const dot = spaceButton("", "space-dot", () => setSpacesState({ coloring: space.id, error: "" }),
        `Цвет пространства «${space.name}»`);
      if (space.color) dot.style.setProperty("--swatch", space.color);
      item.append(dot);
    }
    const open = spaceButton(space.name, "space-open", () => {
      if (space.id === current) return close();
      NyxSpaces.open(space.id).then(() => close(), console.error);
    });
    if (space.id === current) open.setAttribute("aria-current", "true");
    if (index < 9) open.title = IS_WINDOWS ? `Alt+${index + 1}` : `⌃${index + 1}`;
    item.append(open);
    if (space.id !== current && space.id !== "default") {
      item.append(spaceButton("×", "space-remove",
        () => setSpacesState({ confirming: space.id, error: "" }), `Удалить пространство «${space.name}»`));
    }
    return item;
  });
  if (spacesState.creating) {
    const input = nameInput();
    items.push(input);
    queueMicrotask(() => input.focus());
  } else {
    items.push(
      spaceButton("+ Пространство", "space-open space-new", () => setSpacesState({ creating: true, error: "" })),
      spaceButton("+ Временное", "space-open space-new", async () => {
        try {
          const space = await NyxSpaces.createTemporary();
          await NyxSpaces.open(space.id);
          close();
        } catch (error) {
          console.error("NYX: can't create temporary space", error);
          setSpacesState({ error: "Не получилось создать пространство." });
        }
      }, "Временное пространство: стирается целиком, когда его закроешь")
    );
  }
  if (spacesState.error) {
    const error = document.createElement("span");
    error.className = "space-error";
    error.setAttribute("role", "alert");
    error.textContent = spacesState.error;
    items.push(error);
  }
  spacesBar.replaceChildren(...items);
}

// Side panels: the trash (auto-cleanup, last week) and snoozed tabs.
const { NyxTrash } = ChromeUtils.importESModule("chrome://nyx/content/NyxTrash.sys.mjs");
const sideBox = document.getElementById("trash");
let openPanel = null; // "trash" | "snoozed" | null

const hoursAgo = closedAt => {
  const hours = Math.floor((Date.now() - closedAt) / 3600000);
  if (hours < 1) return "только что";
  return hours < 24 ? `${hours} ч назад` : `${Math.floor(hours / 24)} д назад`;
};

const returnsAt = until => new Date(until).toLocaleString("ru-RU", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

function panelRow(item, meta, onClick, ariaLabel) {
  const row = document.createElement("li");
  const button = spaceButton("", "trash-item", onClick, ariaLabel);
  const title = document.createElement("span");
  title.className = "trash-title";
  title.textContent = item.title;
  const detail = document.createElement("span");
  detail.className = "trash-meta";
  detail.textContent = `${new URL(item.url).host} · ${meta}`;
  button.append(title, detail);
  row.append(button);
  return row;
}

// Brings a tab back in the background: its tile shows up here, and the overview stays open.
const reopen = (store, item) => async () => {
  const taken = await store.take(item.id);
  if (taken) browserWindow.openTrustedLinkIn(taken.url, "tabshifted");
  renderSide().catch(console.error);
};

async function renderSide() {
  const [trash, snoozed] = await Promise.all([NyxTrash.list(), NyxSnooze.list()]);
  const panels = [
    { key: "snoozed", label: "Отложено", items: snoozed,
      row: item => panelRow(item, `вернётся ${returnsAt(item.until)}`, reopen(NyxSnooze, item), `Вернуть сейчас «${item.title}»`) },
    { key: "trash", label: "Корзина", items: trash,
      row: item => panelRow(item, hoursAgo(item.closedAt), reopen(NyxTrash, item), `Вернуть «${item.title}»`) },
  ].filter(panel => panel.items.length);
  if (!panels.some(panel => panel.key === openPanel)) openPanel = null;

  const toggles = document.createElement("div");
  toggles.className = "side-toggles";
  for (const panel of panels) {
    const toggle = spaceButton(`${panel.label} · ${panel.items.length}`, "space-open trash-toggle", () => {
      openPanel = openPanel === panel.key ? null : panel.key;
      renderSide().catch(console.error);
    });
    toggle.setAttribute("aria-expanded", String(openPanel === panel.key));
    toggles.append(toggle);
  }
  const children = panels.length ? [toggles] : [];
  const shown = panels.find(panel => panel.key === openPanel);
  if (shown) {
    const list = document.createElement("ul");
    list.className = "trash-list";
    list.append(...shown.items.map(shown.row));
    children.push(list);
    if (shown.key === "trash") {
      children.push(spaceButton("Очистить корзину", "space-action trash-clear", async () => {
        await NyxTrash.clear();
        renderSide().catch(console.error);
      }));
    }
  }
  sideBox.replaceChildren(...children);
}

// Search: typing anywhere dims the tiles that don't match.
const searchInput = document.getElementById("search");
const hint = document.getElementById("hint");

function tabMatches(tab, query) {
  if (!query) return true;
  const url = tabUrl(browserWindow, tab) ?? "";
  const group = tab.group?.label ?? "";
  return [tab.label, url, group].some(text => text.toLowerCase().includes(query));
}

function applySearch() {
  const query = searchInput.value.trim().toLowerCase();
  for (const [tab, tile] of tiles) tile.classList.toggle("dim", !tabMatches(tab, query));
  newTabTile.classList.toggle("dim", Boolean(query));
  return query;
}

function firstMatch() {
  const query = applySearch();
  return currentTabs().find(tab => tabMatches(tab, query)) ?? null;
}

function startSearch(text) {
  searchInput.hidden = false;
  hint.hidden = true;
  searchInput.value += text;
  searchInput.focus();
  const tab = firstMatch();
  if (tab) centerOn(positions.get(tab));
}

function endSearch() {
  searchInput.value = "";
  searchInput.hidden = true;
  hint.hidden = picked.size > 0;
  applySearch();
  focusTab(gBrowser.selectedTab);
}

searchInput.addEventListener("input", () => {
  if (!searchInput.value) return endSearch();
  const tab = firstMatch();
  if (tab) centerOn(positions.get(tab));
});
searchInput.addEventListener("keydown", event => {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    endSearch();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const tab = firstMatch();
    if (tab) openTab(tab);
  } else if (isHiveKey(event)) {
    event.preventDefault();
    close();
  }
});

// Letters and digits start a search. Symbols stay shortcuts (+ and − zoom).
const SEARCH_START = /^[\p{L}\p{N}]$/u;

function onKeyDown(event) {
  if (event.target.matches?.(".space-input")) return;
  if (event.key === "Escape" && !dialog.hidden) {
    event.preventDefault();
    closeDialog();
    return;
  }
  if (event.key === "Escape" && picked.size) {
    event.preventDefault();
    clearPicks();
    return;
  }
  if (SEARCH_START.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    startSearch(event.key);
    return;
  }
  if (event.key === "Escape" || isHiveKey(event)) {
    event.preventDefault();
    close();
  } else if (event.getModifierState("Accel") && event.code === "KeyW") {
    // By key position, so it works on the Russian layout too. Stops the browser closing its own tab.
    event.preventDefault();
    event.stopPropagation();
    const tab = hoveredTab() ?? focusedTab() ?? gBrowser.selectedTab;
    if (tab) closeTab(tab);
  } else if (KEY_MOVES[event.key]) {
    event.preventDefault();
    moveFocus(...KEY_MOVES[event.key]);
  } else if (event.key === "Enter") {
    const tab = focusedTab();
    if (tab) {
      event.preventDefault();
      openTab(tab);
    }
  } else if (event.key === "+" || event.key === "=") {
    zoomAt(innerWidth / 2, innerHeight / 2, KEY_ZOOM);
  } else if (event.key === "-") {
    zoomAt(innerWidth / 2, innerHeight / 2, 1 / KEY_ZOOM);
  }
}

setupViewportInput();
addEventListener("keydown", onKeyDown);
addEventListener("resize", () => centerOn(positions.get(gBrowser.selectedTab) ?? { q: 0, r: 0 }));
TAB_EVENTS.forEach(name => gBrowser.tabContainer.addEventListener(name, render));

render();
applyView();
focusTab(gBrowser.selectedTab);
applyView();
renderSpaces().catch(console.error);
renderSide().catch(console.error);
