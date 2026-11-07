"use strict";

const { NyxTheme, PRESETS, COLOR_LABELS, BUTTONS, TAB_LIMIT_RANGE, MAX_FOCUS_SITES, CUSTOM_BACKGROUND_FILE } = ChromeUtils.importESModule(
  "chrome://nyx/content/NyxTheme.sys.mjs"
);
const { NyxTabs } = ChromeUtils.importESModule("chrome://nyx/content/NyxTabs.sys.mjs");
const { NyxFocus, siteFromInput } = ChromeUtils.importESModule("chrome://nyx/content/NyxFocus.sys.mjs");
const { BACKGROUNDS } = ChromeUtils.importESModule("chrome://nyx/content/NyxBackgrounds.sys.mjs");
const MAX_BACKGROUND_BYTES = 30 * 1024 * 1024;
const BACKGROUND_SIZE = 2560;
const IS_WINDOWS = Services.appinfo.OS === "WINNT";

const MAX_ICON_BYTES = 256 * 1024;
const ACCEPTED_ICON_TYPES = ["image/svg+xml", "image/png"];
const TAB_OPTIONS = { top: "Сверху", left: "Слева" };
const PACK_OPTIONS = { default: "Стандартный", sharp: "Тонкий", bold: "Жирный" };
const CLEANUP_OPTIONS = { 1: "1 ч", 5: "5 ч", 24: "24 ч", 168: "Неделя", 720: "Месяц" };
const SLEEP_OPTIONS = { 10: "10 мин", 30: "30 мин", 60: "1 ч", 180: "3 ч" };
// Monday first, values are Date.getDay().
const DAYS = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"]];
const clockOf = time => new Date(time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

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

function renderDays({ focusDays }) {
  const buttons = DAYS.map(([day, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(focusDays.includes(day)));
    button.addEventListener("click", () => {
      const days = focusDays.includes(day) ? focusDays.filter(each => each !== day) : [...focusDays, day];
      NyxTheme.update({ focusDays: days }).then(render);
    });
    return button;
  });
  byId("focus-days").replaceChildren(...buttons);
}

function renderFocus(settings) {
  const sites = byId("focus-sites");
  // Don't rewrite the list under the cursor while it's being edited.
  if (document.activeElement !== sites) sites.value = settings.focusSites.join("\n");
  byId("focus-schedule").checked = settings.focusSchedule;
  byId("focus-from").value = settings.focusFrom;
  byId("focus-to").value = settings.focusTo;
  byId("focus-days").setAttribute("aria-disabled", String(!settings.focusSchedule));
  renderDays(settings);
  byId("focus-hard-limit").checked = settings.focusHardLimit;
  const manual = NyxFocus.manualUntil;
  byId("focus-now").textContent = manual ? "Выключить фокус" : "Фокус на час";
  byId("focus-status").textContent = manual ? `Фокус до ${clockOf(manual)}.`
    : NyxFocus.active ? "Сейчас фокус по расписанию." : "Сейчас фокус выключен.";
}

function backgroundTile(label, selected, onPick, { image, title } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "background";
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-label", label);
  if (title) button.title = title;
  if (image) {
    const preview = document.createElement("img");
    preview.alt = "";
    preview.src = image;
    button.append(preview);
  }
  const caption = document.createElement("span");
  caption.textContent = label;
  button.append(caption);
  button.addEventListener("click", onPick);
  return button;
}

function renderBackgrounds({ homeBackground, homeDim }) {
  const pick = id => () => NyxTheme.update({ homeBackground: id }).then(render);
  byId("backgrounds").replaceChildren(
    backgroundTile("Чёрный", homeBackground === "none", pick("none")),
    ...BACKGROUNDS.map(each => backgroundTile(each.name, homeBackground === each.id, pick(each.id), {
      image: `chrome://nyx/content/backgrounds/${each.id}-thumb.jpg`,
      title: `${each.name} · ${each.author} · ${each.license}`,
    })),
    backgroundTile("Своя картинка", homeBackground === "custom", () => byId("background-file").click())
  );
  byId("home-dim").value = homeDim;
  byId("home-dim-value").textContent = `${homeDim} %`;
}

function runSips(args) {
  const sips = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  sips.initWithPath("/usr/bin/sips");
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(sips);
  return new Promise(resolve => {
    process.runAsync(args, args.length, { observe: () => resolve(process.exitValue) });
  });
}

// Windows has no sips: Firefox itself decodes the picture (JPG, PNG, WebP) and saves a smaller JPEG.
async function convertWithCanvas(file, target) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, BACKGROUND_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  await IOUtils.write(target, new Uint8Array(await blob.arrayBuffer()));
}

// macOS's own converter turns any supported picture (HEIC included) into a JPEG Firefox can show.
async function setCustomBackground(file) {
  const error = byId("background-error");
  error.textContent = "";
  if (file.size > MAX_BACKGROUND_BYTES) {
    error.textContent = "Файл больше 30 МБ.";
    return;
  }
  const target = PathUtils.join(PathUtils.profileDir, CUSTOM_BACKGROUND_FILE);
  // The picker doesn't reliably give the file's path, so its bytes are copied first.
  const source = `${target}.source`;
  const temporary = `${target}.tmp.jpg`;
  try {
    if (IS_WINDOWS) {
      await convertWithCanvas(file, temporary);
    } else {
      await IOUtils.write(source, new Uint8Array(await file.arrayBuffer()));
      const code = await runSips(["-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", String(BACKGROUND_SIZE), source, "--out", temporary]);
      if (code !== 0 || !(await IOUtils.exists(temporary))) throw new Error(`sips exited with ${code}`);
    }
    await IOUtils.move(temporary, target);
    await NyxTheme.update({ homeBackground: "custom", homeCustomVersion: Date.now() });
    render();
  } catch (cause) {
    console.error("NYX: can't use this picture", cause);
    await IOUtils.remove(temporary, { ignoreAbsent: true });
    error.textContent = `Не получилось открыть картинку. Подходят JPG, PNG, WebP${IS_WINDOWS ? "" : " и HEIC"}.`;
  } finally {
    await IOUtils.remove(source, { ignoreAbsent: true });
  }
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
  byId("tab-sleep").checked = settings.tabSleep;
  renderOptions(byId("sleep-minutes"), SLEEP_OPTIONS, String(settings.sleepMinutes),
    minutes => updateTabs({ sleepMinutes: Number(minutes) }));
  byId("sleep-minutes").setAttribute("aria-disabled", String(!settings.tabSleep));
  renderFocus(settings);
  renderBackgrounds(settings);
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
byId("tab-sleep").addEventListener("change", event => {
  updateTabs({ tabSleep: event.target.checked }).then(render);
});
byId("focus-sites").addEventListener("change", event => {
  const sites = event.target.value.split("\n").map(siteFromInput).filter(Boolean).slice(0, MAX_FOCUS_SITES);
  NyxTheme.update({ focusSites: sites }).then(() => {
    event.target.value = NyxTheme.settings.focusSites.join("\n");
    render();
  });
});
byId("focus-schedule").addEventListener("change", event => {
  NyxTheme.update({ focusSchedule: event.target.checked }).then(render);
});
for (const [id, key] of [["focus-from", "focusFrom"], ["focus-to", "focusTo"]]) {
  byId(id).addEventListener("change", event => {
    // "9:30" and "9.30" become "09:30". Anything else goes back to the saved time.
    const match = /^(\d{1,2})[:.](\d{2})$/.exec(event.target.value.trim());
    const value = match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
    NyxTheme.update(value ? { [key]: value } : {}).then(render);
  });
}
byId("focus-hard-limit").addEventListener("change", event => {
  NyxTheme.update({ focusHardLimit: event.target.checked }).then(render);
});
byId("focus-now").addEventListener("click", () => {
  (NyxFocus.manualUntil ? NyxFocus.stopManual() : NyxFocus.forAnHour()).then(render);
});
if (IS_WINDOWS) {
  for (const key of document.querySelectorAll(".reopen-key")) key.textContent = "Ctrl+Shift+T";
  byId("background-hint").textContent = "Фото природы со свободной лицензией или своя картинка: JPG, PNG или WebP до 30 МБ.";
}

byId("background-file").addEventListener("change", event => {
  const [file] = event.target.files;
  event.target.value = "";
  if (file) setCustomBackground(file);
});
byId("home-dim").addEventListener("input", event => {
  byId("home-dim-value").textContent = `${event.target.value} %`;
});
byId("home-dim").addEventListener("change", event => {
  NyxTheme.update({ homeDim: Number(event.target.value) }).then(render);
});
byId("reset").addEventListener("click", () => NyxTheme.reset().then(() => NyxTabs.refresh()).then(render));

render();
