#!/usr/bin/env python3
"""Rebrands unpacked Firefox omni.ja folders: colors, names, images, theme, home page.

Usage: patch_omni.py <browser omni dir> <toolkit omni dir> <repo root>
Fails loudly if an expected file is missing, so a Firefox update can't silently undo it.
"""
import colorsys
import re
import shutil
import sys
from pathlib import Path

BROWSER_DIR = Path(sys.argv[1])
TOOLKIT_DIR = Path(sys.argv[2])
REPO = Path(sys.argv[3])

LOGO = REPO / "branding/generated/logo.svg"
WORDMARK = REPO / "branding/wordmark.svg"
TOKENS_SHARED = "chrome/toolkit/skin/classic/global/design-system/tokens-shared.css"
TOKENS_PLATFORM = "chrome/toolkit/skin/classic/global/design-system/tokens-platform.css"
TOKENS_BRAND = "chrome/toolkit/skin/classic/global/design-system/tokens-brand.css"
BROWSER_SHARED = "chrome/browser/skin/classic/browser/browser-shared.css"
CHROME_MANIFEST = "chrome/chrome.manifest"

# Only product UI: leaves devtools and license pages alone.
COLOR_ROOTS = [BROWSER_DIR / "chrome/browser", TOOLKIT_DIR / "chrome/toolkit"]
TEXT_ROOTS = [BROWSER_DIR / "localization", TOOLKIT_DIR / "localization",
              BROWSER_DIR / "chrome", TOOLKIT_DIR / "chrome"]

# Purple hues, in degrees. Blues (up to ~235) stay: links and info colors use them.
PURPLE_MIN, PURPLE_MAX = 240, 345

HEX = re.compile(r"#([0-9a-fA-F]{6})\b")
RGB = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")
OKLCH = re.compile(r"oklch\(([\d.]+%?)\s+([\d.]+)\s+([\d.]+)")
TOKEN_GRAY = re.compile(r"(--color-gray-\d+:\s*)#([0-9a-fA-F]{6})")
WORDS = [(re.compile(r"\bMozilla Firefox\b"), "NYX Browser"),
         (re.compile(r"\bFirefox\b"), "NYX"),
         (re.compile(r"\bMozilla\b"), "NYX")]

# Fox art and Firefox logos, matched by file name.
LOGO_FILE = re.compile(r"(^kit-|^fox-|foxy|avatar-fox|^firefox\.svg$|share-firefox|window-firefox|mozilla-16"
                       r"|^no-connection\.svg$|^error-malformed-url\.svg$|^security-error\.svg$)")
WORDMARK_FILES = ["about-wordmark.svg", "firefox-wordmark.svg"]

# Firefox's own new tab page, still reachable by typing about:home or about:newtab.
NEWTAB_PAGES = ["activity-stream.html", "activity-stream-noscripts.html"]
BLANK_PAGE = """<!doctype html>
<html style="background: #000">
  <head><meta charset="utf-8" /><title>New Tab</title></head>
  <body></body>
</html>
"""

ABOUT_DIALOG_CSS = """
#aboutDialogContainer, #bottomBox { background-color: #000 !important; }
#rightBox { min-width: 320px; }
#updateBox, #releasenotes, #aboutDialogHelpLink, #submit-feedback,
#communityDesc, #communityExperimentalDesc, #contributeDesc, #contributeDescReferrals,
#trademark, .bottom-link:not(:first-child) { display: none !important; }
"""

SETTINGS_CSS = """
#policies-container-content, #helpButton, #category-about-firefox, #category-ai-features,
#category-experimental, #category-more-from-mozilla { display: none !important; }
"""

WINDOW_ADDITIONS = [
    ('<toolbarbutton id="appMenu-settings-button"',
     '<toolbarbutton id="appMenu-nyx-hive" class="subviewbutton" label="Соты" key="key_nyxHive"/>\n      '
     '<toolbarbutton id="appMenu-nyx-customize" class="subviewbutton" label="Кастомизация"/>\n      '),
    ('<toolbaritem id="PanelUI-button"',
     '<toolbarbutton id="nyx-hive-button" class="toolbarbutton-1" removable="false" tooltiptext="Соты (⌥Tab)"/>\n    '),
    ('<key id="key_newNavigatorTab"',
     '<key id="key_nyxHive" keycode="VK_TAB" modifiers="alt" reserved="true"/>\n    '),
]

SETTINGS_GROUPS_OLD = re.compile(
    r'groupIds: \[\s*"defaultBrowserSync",\s*"accountDisabled",.*?"referrals",\s*\]', re.S)
SETTINGS_GROUPS_NEW = 'groupIds: ["defaultBrowserSync", "importBrowserData"]'


def require(path):
    if not path.exists():
        sys.exit(f"patch_omni: {path} not found, Firefox layout changed")
    return path


def to_gray(r, g, b):
    return round(0.2126 * r + 0.7152 * g + 0.0722 * b)


def is_purple(r, g, b):
    h, _, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return s > 0.04 and PURPLE_MIN <= h * 360 <= PURPLE_MAX


def fix_hex(match):
    value = match.group(1)
    r, g, b = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    if not is_purple(r, g, b):
        return match.group(0)
    return "#" + f"{to_gray(r, g, b):02x}" * 3


def fix_rgb(match):
    r, g, b = (int(v) for v in match.groups())
    if not is_purple(r, g, b):
        return match.group(0)
    gray = to_gray(r, g, b)
    prefix = match.group(0).split("(")[0]
    return f"{prefix}({gray}, {gray}, {gray}"


def fix_oklch(match):
    lightness, chroma, hue = match.groups()
    # oklch puts violet and purple roughly between 270 and 340.
    if 265 <= float(hue) <= 345:
        return f"oklch({lightness} 0 {hue}"
    return match.group(0)


def fix_gray_token(match):
    value = match.group(2)
    r, g, b = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    return match.group(1) + "#" + f"{to_gray(r, g, b):02x}" * 3


def strip_purple():
    changed = 0
    for root in COLOR_ROOTS:
        for path in root.rglob("*"):
            if path.suffix not in (".css", ".svg") or not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="surrogateescape")
            new = HEX.sub(fix_hex, text)
            new = RGB.sub(fix_rgb, new)
            new = OKLCH.sub(fix_oklch, new)
            new = TOKEN_GRAY.sub(fix_gray_token, new)
            if new != text:
                path.write_text(new, encoding="utf-8", errors="surrogateescape")
                changed += 1
    print(f"purple removed from {changed} files")


def rename_value(text):
    for pattern, name in WORDS:
        text = pattern.sub(name, text)
    return text


def rename_ftl_line(line):
    # Message ids on the left of "=" must stay as they are.
    stripped = line.lstrip()
    if stripped.startswith("#"):
        return line
    if "=" in line and re.match(r"\s*[-.\w]+\s*=", line):
        key, value = line.split("=", 1)
        return f"{key}={rename_value(value)}"
    return rename_value(line)


def rename_product():
    changed = 0
    for root in TEXT_ROOTS:
        for path in root.rglob("*"):
            if path.suffix not in (".ftl", ".properties", ".dtd") or not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="surrogateescape")
            new = "".join(rename_ftl_line(line) for line in text.splitlines(keepends=True))
            if new != text:
                path.write_text(new, encoding="utf-8", errors="surrogateescape")
                changed += 1
    print(f"names replaced in {changed} files")


def replace_art():
    logo_count = 0
    for root in COLOR_ROOTS:
        for path in root.rglob("*.svg"):
            if LOGO_FILE.search(path.name):
                shutil.copy(LOGO, path)
                logo_count += 1
    branding = require(BROWSER_DIR / "chrome/browser/content/branding")
    for name in WORDMARK_FILES:
        shutil.copy(WORDMARK, require(branding / name))
    print(f"logo placed over {logo_count} images")


def append(path, source):
    with require(path).open("a", encoding="utf-8") as out:
        out.write("\n" + source.read_text(encoding="utf-8"))


def add_theme():
    # Unlayered rules at the end of these files beat Firefox's layered tokens.
    # No runtime stylesheet loading means no flash of the original look.
    # Settings use the platform tokens; about: and error pages use the brand tokens.
    append(TOOLKIT_DIR / TOKENS_PLATFORM, REPO / "chrome/nyx-tokens.css")
    append(TOOLKIT_DIR / TOKENS_BRAND, REPO / "chrome/nyx-tokens.css")
    append(BROWSER_DIR / BROWSER_SHARED, REPO / "chrome/nyx-browser.css")
    dialog = require(BROWSER_DIR / "chrome/browser/content/branding/aboutDialog.css")
    with dialog.open("a", encoding="utf-8") as out:
        out.write(ABOUT_DIALOG_CSS)


def clean_pages():
    prerendered = BROWSER_DIR / "chrome/browser/builtin-addons/newtab/prerendered"
    for name in NEWTAB_PAGES:
        require(prerendered / name).write_text(BLANK_PAGE, encoding="utf-8")

    settings_css = require(BROWSER_DIR / "chrome/browser/skin/classic/browser/preferences/preferences.css")
    with settings_css.open("a", encoding="utf-8") as out:
        out.write(SETTINGS_CSS)

    settings_js = require(BROWSER_DIR / "chrome/browser/content/browser/preferences/preferences.js")
    text, count = SETTINGS_GROUPS_OLD.subn(SETTINGS_GROUPS_NEW, settings_js.read_text(encoding="utf-8"))
    if count != 1:
        sys.exit("patch_omni: settings groups not found, Firefox layout changed")
    settings_js.write_text(text, encoding="utf-8")

    settings_ftl = require(BROWSER_DIR / "localization/en-US/browser/preferences/preferences.ftl")
    text = settings_ftl.read_text(encoding="utf-8")
    if "Account and sync" not in text:
        sys.exit("patch_omni: settings section title not found, Firefox layout changed")
    settings_ftl.write_text(text.replace("Account and sync", "General"), encoding="utf-8")


def add_home():
    target = BROWSER_DIR / "chrome/nyx"
    shutil.copytree(REPO / "chrome/home", target, dirs_exist_ok=True)
    with require(BROWSER_DIR / CHROME_MANIFEST).open("a", encoding="utf-8") as out:
        out.write("\ncontent nyx nyx/\n")

    window = require(BROWSER_DIR / "chrome/browser/content/browser/browser.xhtml")
    text = window.read_text(encoding="utf-8")
    for anchor, addition in WINDOW_ADDITIONS:
        if anchor not in text:
            sys.exit(f"patch_omni: {anchor} not found, Firefox layout changed")
        text = text.replace(anchor, addition + anchor, 1)
    window.write_text(text, encoding="utf-8")


def main():
    require(TOOLKIT_DIR / TOKENS_SHARED)
    strip_purple()
    rename_product()
    replace_art()
    add_theme()
    clean_pages()
    add_home()


if __name__ == "__main__":
    main()
