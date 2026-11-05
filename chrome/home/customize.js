"use strict";

const { NyxTheme, PRESETS, COLOR_LABELS, BUTTONS, TAB_LIMIT_RANGE } = ChromeUtils.importESModule(
  "chrome://nyx/content/NyxTheme.sys.mjs"
);
const { NyxTabs } = ChromeUtils.importESModule("chrome://nyx/content/NyxTabs.sys.mjs");

const MAX_ICON_BYTES = 256 * 1024;
const ACCEPTED_ICON_TYPES = ["image/svg+xml", "image/png"];
const TAB_OPTIONS = { top: "Сверху", left: "Слева" };
const PACK_OPTIONS = { default: "Стандартный", sharp: "Тонкий", bold: "Жирный" };
const CLEANUP_OPTIONS = { 1: "1 ч", 5: "5 ч", 24: "24 ч", 168: "Неделя", 720: "Месяц" };

function updateTabs(changes) {
  return NyxTheme.update(changes).then(() => NyxTabs.refresh());
}

const byId = id => document.getElementById(id);

function renderOptions(container, options, selected, onPick) {
  const buttons = Object.entries(options).map(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(value === selected));
    button.addEventListener("click", () => onPick(value).then(render));
    return button;
  });
  container.replaceChildren(...buttons);
}

function renderColors({ colors }) {
  const rows = Object.entries(COLOR_LABELS).map(([key, label]) => {
    const row = document.createElement("label");
    row.className = "row";
    const input = document.createElement("input");
    input.type = "color";
    input.value = colors[key];
    // "input" fires continuously while dragging in the picker, so the browser recolors live.
    input.addEventListener("input", () => {
      const next = NyxTheme.settings.colors;
      next[key] = input.value;
      NyxTheme.update({ preset: "custom", colors: next }).then(renderPresets);
    });
    const text = document.createElement("span");
    text.textContent = label;
    row.append(input, text);
    return row;
  });
  byId("colors").replaceChildren(...rows);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function setCustomIcon(id, file) {
  const error = byId("icon-error");
  error.textContent = "";
  if (!ACCEPTED_ICON_TYPES.includes(file.type)) {
    error.textContent = "Подходят только SVG и PNG.";
    return;
  }
  if (file.size > MAX_ICON_BYTES) {
    error.textContent = "Файл больше 256 КБ.";
    return;
  }
  try {
    const customIcons = NyxTheme.settings.customIcons;
    customIcons[id] = await readAsDataUrl(file);
    await NyxTheme.update({ customIcons });
    render();
  } catch (cause) {
    console.error("NYX: can't read icon", cause);
    error.textContent = "Не удалось прочитать файл.";
  }
}

async function removeCustomIcon(id) {
  const customIcons = NyxTheme.settings.customIcons;
  delete customIcons[id];
  await NyxTheme.update({ customIcons });
  render();
}

function createIconRow(id, label, customIcon) {
  const row = document.createElement("div");
  row.className = "icon-row";

  const name = document.createElement("span");
  name.textContent = label;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ACCEPTED_ICON_TYPES.join(",");
  input.hidden = true;
  input.addEventListener("change", () => {
    if (input.files[0]) setCustomIcon(id, input.files[0]);
  });

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "icon-button";
  choose.textContent = "Выбрать";
  choose.setAttribute("aria-label", `Выбрать иконку: ${label}`);
  choose.addEventListener("click", () => input.click());

  row.append(name, input);
  if (customIcon) {
    const preview = document.createElement("img");
    preview.className = "icon-preview";
    preview.alt = "";
    preview.src = customIcon;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.textContent = "Убрать";
    remove.setAttribute("aria-label", `Убрать иконку: ${label}`);
    remove.addEventListener("click", () => removeCustomIcon(id));
    row.append(preview, remove);
  }
  row.append(choose);
  return row;
}

function renderIcons({ customIcons }) {
  const rows = Object.entries(BUTTONS).map(([id, { label }]) => createIconRow(id, label, customIcons[id]));
  byId("icons").replaceChildren(...rows);
}

function renderPresets() {
  const labels = Object.fromEntries(Object.entries(PRESETS).map(([name, preset]) => [name, preset.label]));
  renderOptions(byId("presets"), labels, NyxTheme.settings.preset, name => NyxTheme.usePreset(name));
}

function render() {
  const settings = NyxTheme.settings;
  renderPresets();
  renderColors(settings);
  renderIcons(settings);
  renderOptions(byId("tabs"), TAB_OPTIONS, settings.tabs, tabs => NyxTheme.update({ tabs }));
  renderOptions(byId("packs"), PACK_OPTIONS, settings.iconPack, iconPack => NyxTheme.update({ iconPack }));
  byId("metal").checked = settings.metal;
  byId("animations").checked = settings.animations;
  renderOptions(byId("cleanup-hours"), CLEANUP_OPTIONS, String(settings.cleanupHours),
    hours => updateTabs({ cleanupHours: Number(hours) }));
  byId("cleanup-hours").setAttribute("aria-disabled", String(!settings.tabCleanup));
  byId("tab-cleanup").checked = settings.tabCleanup;
  byId("tab-warning").checked = settings.tabWarning;
  byId("tab-limit").value = settings.tabLimit;
  byId("update-check").checked = settings.updateCheck;
}

byId("metal").addEventListener("change", event => {
  NyxTheme.update({ preset: "custom", metal: event.target.checked }).then(render);
});
byId("animations").addEventListener("change", event => {
  NyxTheme.update({ animations: event.target.checked }).then(render);
});
byId("tab-cleanup").addEventListener("change", event => {
  updateTabs({ tabCleanup: event.target.checked }).then(render);
});
byId("tab-warning").addEventListener("change", event => {
  updateTabs({ tabWarning: event.target.checked }).then(render);
});
byId("tab-limit").addEventListener("change", event => {
  const limit = Math.round(Number(event.target.value));
  const clamped = Math.min(TAB_LIMIT_RANGE.max, Math.max(TAB_LIMIT_RANGE.min, limit || TAB_LIMIT_RANGE.min));
  updateTabs({ tabLimit: clamped }).then(render);
});
byId("update-check").addEventListener("change", event => {
  NyxTheme.update({ updateCheck: event.target.checked }).then(render);
});
byId("reset").addEventListener("click", () => NyxTheme.reset().then(() => NyxTabs.refresh()).then(render));

render();
