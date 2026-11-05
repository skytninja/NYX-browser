"use strict";

// Home page: one tile per pinned tab. No pins means an empty black page.
const browserWindow = window.browsingContext.topChromeWindow;
const { gBrowser } = browserWindow;
const pins = document.getElementById("pins");
const WATCHED_EVENTS = ["TabPinned", "TabUnpinned", "TabAttrModified", "TabClose", "TabOpen"];

function fallbackLetter(tab) {
  return (tab.label.trim()[0] || "?").toUpperCase();
}

function renderIcon(container, tab) {
  const source = gBrowser.getIcon(tab);
  if (!source) {
    container.textContent = fallbackLetter(tab);
    return;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.src = source;
  image.addEventListener("error", () => {
    container.textContent = fallbackLetter(tab);
  });
  container.append(image);
}

function createTile(tab) {
  const tile = document.createElement("button");
  tile.className = "pin";
  tile.title = tab.label;
  tile.addEventListener("click", () => {
    gBrowser.selectedTab = tab;
  });

  const icon = document.createElement("span");
  icon.className = "pin-icon";
  renderIcon(icon, tab);

  const title = document.createElement("span");
  title.className = "pin-title";
  title.textContent = tab.label;

  tile.append(icon, title);
  return tile;
}

function render() {
  const tabs = gBrowser.tabs.filter(tab => tab.pinned && !tab.closing);
  pins.replaceChildren(...tabs.map(createTile));
}

const container = gBrowser.tabContainer;
WATCHED_EVENTS.forEach(name => container.addEventListener(name, render));
window.addEventListener("unload", () => {
  WATCHED_EVENTS.forEach(name => container.removeEventListener(name, render));
});
render();
