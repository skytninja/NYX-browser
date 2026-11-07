#!/bin/bash
# Builds dist/NYX-Browser-Setup-<version>.exe for Windows x64 on this Mac.
# Needs: brew install sevenzip makensis mingw-w64
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT/versions.sh"

CACHE="$ROOT/.cache"
WORK="$ROOT/.build-win"
DIST="$ROOT/dist"
BRANDING="$ROOT/branding/generated"
APP="$WORK/app"

log() { echo "==> $*"; }

for tool in 7zz makensis x86_64-w64-mingw32-gcc x86_64-w64-mingw32-windres; do
  command -v "$tool" >/dev/null || { echo "$tool not found: brew install sevenzip makensis mingw-w64" >&2; exit 1; }
done

fetch() { # url, destination, sha256
  if [ ! -f "$2" ]; then
    log "Downloading $(basename "$2")"
    curl -fsSL -o "$2.part" "$1"
    mv "$2.part" "$2"
  fi
  echo "$3  $2" | shasum -a 256 -c --quiet
}

log "Preparing folders"
mkdir -p "$CACHE" "$DIST"
rm -rf "$WORK"
mkdir -p "$WORK"

FF_SETUP="$CACHE/Firefox Setup $FF_VERSION win64.exe"
UBLOCK_XPI="$CACHE/uBlock0_$UBLOCK_VERSION.firefox.signed.xpi"
fetch "https://archive.mozilla.org/pub/firefox/releases/$FF_VERSION/win64/$FF_LOCALE/Firefox%20Setup%20$FF_VERSION.exe" "$FF_SETUP" "$FF_WIN_SHA256"
fetch "https://github.com/gorhill/uBlock/releases/download/$UBLOCK_VERSION/uBlock0_$UBLOCK_VERSION.firefox.signed.xpi" "$UBLOCK_XPI" "$UBLOCK_SHA256"

log "Unpacking Firefox"
# The official installer is a 7-Zip archive; core/ is the program folder.
7zz x -y -o"$WORK/setup" "$FF_SETUP" >/dev/null
mv "$WORK/setup/core" "$APP"
rm -rf "$WORK/setup"
# Mozilla's updater, background agents, telemetry sender and uninstaller: NYX updates through its own
# installer. private_browsing.exe would open Firefox's own profile, not NYX's.
rm -rf "$APP/updater.exe" "$APP/update-settings.ini" "$APP/maintenanceservice.exe" \
  "$APP/maintenanceservice_installer.exe" "$APP/default-browser-agent.exe" "$APP/pingsender.exe" \
  "$APP/private_browsing.exe" "$APP/private_browsing.VisualElementsManifest.xml" "$APP/uninstall"

log "Building launcher and icon"
# Made by branding/make_icon.py: 16 and 32 px carry the simplified picture.
cp "$BRANDING/nyx.ico" "$WORK/nyx.ico"
printf '1 ICON "nyx.ico"\n' > "$WORK/launcher.rc"
(cd "$WORK" && x86_64-w64-mingw32-windres launcher.rc -O coff -o launcher.res)
x86_64-w64-mingw32-gcc -O2 -s -municode -mwindows "$ROOT/branding/launcher-win.c" "$WORK/launcher.res" \
  -o "$APP/nyx.exe" -lshell32 -lole32 -luuid
# Window and taskbar icon of the browser itself (firefox.exe keeps Mozilla's icon inside).
mkdir -p "$APP/browser/chrome/icons/default"
cp "$WORK/nyx.ico" "$APP/browser/chrome/icons/default/main-window.ico"

log "Rebranding omni.ja"
"$ROOT/branding/brand_omni.sh" "$APP" win "$WORK"

log "Adding config and uBlock Origin"
mkdir -p "$APP/defaults/pref" "$APP/distribution/extensions"
cp "$ROOT/config/autoconfig.js" "$APP/defaults/pref/autoconfig.js"
cp "$ROOT/config/mozilla.cfg" "$APP/mozilla.cfg"
# The policy's install_url points into the macOS .app. On Windows the copy in distribution/extensions
# is what installs; if it ever doesn't, the policy falls back to the same signed release on GitHub.
python3 -I -c "
import json, sys
policies = json.load(open(sys.argv[1], encoding='utf-8'))
policies['policies']['ExtensionSettings']['uBlock0@raymondhill.net']['install_url'] = sys.argv[3]
json.dump(policies, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
" "$ROOT/config/policies.json" "$APP/distribution/policies.json" \
  "https://github.com/gorhill/uBlock/releases/download/$UBLOCK_VERSION/uBlock0_$UBLOCK_VERSION.firefox.signed.xpi"
cp "$UBLOCK_XPI" "$APP/distribution/extensions/uBlock0@raymondhill.net.xpi"
# Read by the launcher: a new value makes it clear Firefox's interface cache once per profile.
uuidgen > "$APP/nyx-build-stamp"
# Read by the update check.
echo "$NYX_VERSION" > "$APP/nyx-version"

log "Building installer"
SETUP="$DIST/NYX-Browser-Setup-$NYX_VERSION.exe"
rm -f "$SETUP"
makensis -V2 -DVERSION="$NYX_VERSION" -DSRC="$APP" -DOUT="$SETUP" -DICON="$WORK/nyx.ico" "$ROOT/branding/installer.nsi"
rm -rf "$WORK"

log "Done"
du -sh "$SETUP"
