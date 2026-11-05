// NYX appearance settings: stored in the profile, applied to the whole browser through a user stylesheet.

const SETTINGS_FILE = "nyx-theme.json";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ICON_DATA_URL = /^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/=]+$/;
const PACKS = ["default", "sharp", "bold"];
const TAB_POSITIONS = ["top", "left"];
export const CLEANUP_HOURS = [1, 5, 24, 24 * 7, 24 * 30];
export const TAB_LIMIT_RANGE = { min: 5, max: 500 };
const METAL_GRADIENT =
  "linear-gradient(135deg, #f4f4f4 0%, #c8c8c8 22%, #8c8c8c 40%, #efefef 55%, #b4b4b4 75%, #dcdcdc 100%)";
const METAL_FILTER = 'url("chrome://nyx/content/metal.svg#metal")';

export const CUSTOMIZE_URL = "chrome://nyx/content/customize.html";

export const BUTTONS = {
  "back-button": { label: "Назад", icon: "back" },
  "forward-button": { label: "Вперёд", icon: "forward" },
  "reload-button": { label: "Обновить", icon: "reload" },
  "stop-button": { label: "Стоп", icon: "stop" },
  "tabs-newtab-button": { label: "Новая вкладка", icon: "newtab" },
  "unified-extensions-button": { label: "Расширения", icon: "extensions" },
  "PanelUI-menu-button": { label: "Меню", icon: "menu" },
};

export const COLOR_LABELS = {
  bg: "Фон страниц",
  toolbar: "Панели",
  surface: "Карточки и меню",
  hover: "Наведение",
  border: "Разделители",
  text: "Текст",
  muted: "Второстепенный текст",
  accent: "Акцент",
  icon: "Иконки",
};

export const PRESETS = {
  chrome: {
    label: "Жидкое серебро",
    metal: true,
    colors: {
      bg: "#000000", toolbar: "#1a1a1a", surface: "#101010", hover: "#2a2a2a", border: "#333333",
      text: "#ededed", muted: "#a8a8a8", accent: "#d8d8d8", icon: "#d8d8d8",
    },
  },
  black: {
    label: "Чисто чёрная",
    metal: false,
    colors: {
      bg: "#000000", toolbar: "#000000", surface: "#0c0c0c", hover: "#1f1f1f", border: "#262626",
      text: "#e6e6e6", muted: "#9a9a9a", accent: "#c8c8c8", icon: "#c8c8c8",
    },
  },
  graphite: {
    label: "Графит",
    metal: false,
    colors: {
      bg: "#17181a", toolbar: "#222326", surface: "#1d1e21", hover: "#303236", border: "#3a3c40",
      text: "#ececec", muted: "#a2a4a8", accent: "#c4c6ca", icon: "#c4c6ca",
    },
  },
};

const DEFAULTS = {
  preset: "chrome",
  metal: true,
  colors: PRESETS.chrome.colors,
  iconPack: "default",
  customIcons: {},
  tabs: "top",
  animations: true,
  tabCleanup: false,
  cleanupHours: 24,
  tabWarning: true,
  tabLimit: 20,
  updateCheck: true,
};

const sheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

function settingsFile() {
  const file = Services.dirsvc.get("ProfD", Ci.nsIFile);
  file.append(SETTINGS_FILE);
  return file;
}

// The file can be edited by hand, so only known and well-formed values reach the stylesheet.
function clean(raw) {
  const settings = structuredClone(DEFAULTS);
  if (PRESETS[raw.preset] || raw.preset === "custom") settings.preset = raw.preset;
  if (typeof raw.metal === "boolean") settings.metal = raw.metal;
  for (const key of Object.keys(DEFAULTS.colors)) {
    if (HEX_COLOR.test(raw.colors?.[key])) settings.colors[key] = raw.colors[key];
  }
  if (PACKS.includes(raw.iconPack)) settings.iconPack = raw.iconPack;
  for (const id of Object.keys(BUTTONS)) {
    if (ICON_DATA_URL.test(raw.customIcons?.[id])) settings.customIcons[id] = raw.customIcons[id];
  }
  if (TAB_POSITIONS.includes(raw.tabs)) settings.tabs = raw.tabs;
  if (typeof raw.animations === "boolean") settings.animations = raw.animations;
  if (typeof raw.tabCleanup === "boolean") settings.tabCleanup = raw.tabCleanup;
  if (CLEANUP_HOURS.includes(raw.cleanupHours)) settings.cleanupHours = raw.cleanupHours;
  if (typeof raw.tabWarning === "boolean") settings.tabWarning = raw.tabWarning;
  if (Number.isInteger(raw.tabLimit) && raw.tabLimit >= TAB_LIMIT_RANGE.min && raw.tabLimit <= TAB_LIMIT_RANGE.max) {
    settings.tabLimit = raw.tabLimit;
  }
  if (typeof raw.updateCheck === "boolean") settings.updateCheck = raw.updateCheck;
  return settings;
}

function load() {
  const file = settingsFile();
  if (!file.exists()) return structuredClone(DEFAULTS);
  try {
    return clean(JSON.parse(Cu.readUTF8File(file)));
  } catch (error) {
    console.error("NYX: theme settings unreadable, using defaults", error);
    return structuredClone(DEFAULTS);
  }
}

function buildSheet(settings) {
  const { colors, metal, animations, iconPack, customIcons, tabs } = settings;
  const variables = Object.entries(colors).map(([key, value]) => `--nyx-${key}: ${value} !important;`);
  variables.push(
    `--nyx-toolbar-fill: linear-gradient(180deg, ${colors.toolbar}, ${colors.bg}) !important;`,
    `--nyx-tab-selected-fill: ${metal ? METAL_GRADIENT : colors.hover} !important;`,
    `--nyx-tab-selected-text: ${metal ? "#0a0a0a" : colors.text} !important;`,
    `--nyx-icon-filter: ${metal ? METAL_FILTER : "none"} !important;`,
    `--nyx-extension-filter: ${metal ? "grayscale(1) brightness(1.25)" : "none"} !important;`,
    `--nyx-speed: ${animations ? "160ms" : "0ms"} !important;`
  );

  const icons = Object.entries(BUTTONS).flatMap(([id, { icon }]) => {
    if (customIcons[id]) {
      return [`#${id} { list-style-image: url("${customIcons[id]}") !important; }`,
              `#${id} .toolbarbutton-icon { filter: none !important; }`];
    }
    return iconPack === "default" ? []
      : [`#${id} { list-style-image: url("chrome://nyx/content/icons/${iconPack}/${icon}.svg") !important; }`];
  });

  return `@-moz-document url-prefix("chrome:"), url-prefix("about:") {
  :root, :host { ${variables.join(" ")} }
}
@-moz-document url("chrome://browser/content/browser.xhtml") {
  ${icons.join("\n  ")}
  ${tabs === "top" ? "#sidebar-container { display: none !important; }" : ""}
}`;
}

let current = load();
let sheetUri = null;

export const NyxTheme = {
  get settings() {
    return structuredClone(current);
  },

  apply() {
    if (sheetUri) sheetService.unregisterSheet(sheetUri, sheetService.USER_SHEET);
    sheetUri = Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(buildSheet(current))}`);
    sheetService.loadAndRegisterSheet(sheetUri, sheetService.USER_SHEET);
    Services.prefs.setBoolPref("sidebar.verticalTabs", current.tabs === "left");
  },

  async update(changes) {
    current = clean({ ...current, ...changes });
    this.apply();
    await IOUtils.writeJSON(settingsFile().path, current, { tmpPath: `${settingsFile().path}.tmp` });
  },

  usePreset(name) {
    const { metal, colors } = PRESETS[name];
    return this.update({ preset: name, metal, colors });
  },

  reset() {
    return this.update(structuredClone(DEFAULTS));
  },
};
