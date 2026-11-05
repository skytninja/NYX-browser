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
const TAB_EVENTS = ["TabOpen", "TabClose", "TabPinned", "TabUnpinned", "TabAttrModified"];
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
  info.append(icon, title);
  open.append(shot, info);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "tile-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Закрыть вкладку");
  // Without this the field below captures the pointer and the click never reaches the button.
  closeButton.addEventListener("pointerdown", event => event.stopPropagation());
  closeButton.addEventListener("click", () => closeTab(tab));

  tile.append(open, closeButton);
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
    if (event.button !== 0 || event.target.closest(".tile-close")) return;
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
      if (event.type === "pointerup") openTab(tab);
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

// Spaces bar: switch, create, delete. The browser for another space is its own process.
const { NyxSpaces } = ChromeUtils.importESModule("chrome://nyx/content/NyxSpaces.sys.mjs");
const spacesBar = document.getElementById("spaces");
const spacesState = { creating: false, confirming: null, error: "" };

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

async function renderSpaces() {
  const spaces = await NyxSpaces.list();
  const current = NyxSpaces.currentId;
  const items = spaces.map(space => {
    if (spacesState.confirming === space.id) return confirmRow(space);
    const item = document.createElement("span");
    item.className = "space";
    const open = spaceButton(space.name, "space-open", () => {
      if (space.id === current) return close();
      NyxSpaces.open(space.id).then(() => close(), console.error);
    });
    if (space.id === current) open.setAttribute("aria-current", "true");
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
    items.push(spaceButton("+ Пространство", "space-open space-new", () => setSpacesState({ creating: true, error: "" })));
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

function onKeyDown(event) {
  if (event.target.matches?.(".space-input")) return;
  if (event.key === "Escape" || (event.altKey && event.key === "Tab")) {
    event.preventDefault();
    close();
  } else if (event.metaKey && event.code === "KeyW") {
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
