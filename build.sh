#!/bin/bash
# Builds dist/NYX Browser.app and a .dmg from the official Firefox release.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT/versions.sh"
BUNDLE_ID="org.nyx.browser"

CACHE="$ROOT/.cache"
WORK="$ROOT/.build"
DIST="$ROOT/dist"
BRANDING="$ROOT/branding/generated"
APP="$WORK/$APP_NAME.app"
PLIST="$APP/Contents/Info.plist"
RES="$APP/Contents/Resources"
PB=/usr/libexec/PlistBuddy
MOUNT=""

cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach "$MOUNT" -quiet || true; fi
}
trap cleanup EXIT

log() { echo "==> $*"; }

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

FF_DMG="$CACHE/Firefox-$FF_VERSION-$FF_LOCALE.dmg"
UBLOCK_XPI="$CACHE/uBlock0_$UBLOCK_VERSION.firefox.signed.xpi"
fetch "https://ftp.mozilla.org/pub/firefox/releases/$FF_VERSION/mac/$FF_LOCALE/Firefox%20$FF_VERSION.dmg" "$FF_DMG" "$FF_SHA256"
fetch "https://github.com/gorhill/uBlock/releases/download/$UBLOCK_VERSION/uBlock0_$UBLOCK_VERSION.firefox.signed.xpi" "$UBLOCK_XPI" "$UBLOCK_SHA256"

log "Copying Firefox out of the dmg"
MOUNT="$WORK/mnt"
mkdir -p "$MOUNT"
hdiutil attach "$FF_DMG" -nobrowse -readonly -quiet -mountpoint "$MOUNT"
ditto "$MOUNT/Firefox.app" "$APP"
hdiutil detach "$MOUNT" -quiet
MOUNT=""
rmdir "$WORK/mnt"

log "Patching Info.plist"
"$PB" -c "Set :CFBundleName $APP_NAME" \
      -c "Set :CFBundleIdentifier $BUNDLE_ID" \
      -c "Set :CFBundleGetInfoString $APP_NAME $NYX_VERSION (Firefox $FF_VERSION)" \
      -c "Set :CFBundleShortVersionString $NYX_VERSION" \
      -c "Set :CFBundleExecutable nyx-launcher" \
      -c "Delete :CFBundleIconName" \
      -c "Delete :SMPrivilegedExecutables" "$PLIST"
"$PB" -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
# Permission prompts mention the product name.
for key in $("$PB" -c Print "$PLIST" | awk '/UsageDescription = /{print $1}'); do
  value="$("$PB" -c "Print :$key" "$PLIST")"
  "$PB" -c "Set :$key ${value//Firefox/$APP_NAME}" "$PLIST"
done
echo "CFBundleName = \"$APP_NAME\";" > "$RES/en.lproj/InfoPlist.strings"
# Mozilla's provisioning profile and privileged updater are tied to their signature.
rm -f "$APP/Contents/embedded.provisionprofile"
rm -rf "$APP/Contents/Library/LaunchServices"

log "Building launcher"
clang -O2 -arch x86_64 -arch arm64 -mmacosx-version-min=10.15 \
  "$ROOT/branding/launcher.c" -o "$APP/Contents/MacOS/nyx-launcher"

log "Replacing icons"
iconutil -c icns "$BRANDING/nyx.iconset" -o "$RES/firefox.icns"
cp "$RES/firefox.icns" "$RES/document.icns"

log "Rebranding omni.ja"
"$ROOT/branding/brand_omni.sh" "$RES" mac "$WORK"

log "Adding config and uBlock Origin"
mkdir -p "$RES/defaults/pref" "$RES/distribution/extensions"
cp "$ROOT/config/autoconfig.js" "$RES/defaults/pref/autoconfig.js"
cp "$ROOT/config/mozilla.cfg" "$RES/mozilla.cfg"
cp "$ROOT/config/policies.json" "$RES/distribution/policies.json"
cp "$UBLOCK_XPI" "$RES/distribution/extensions/uBlock0@raymondhill.net.xpi"
# Read by the launcher: a new value makes it clear Firefox's interface cache once per profile.
uuidgen > "$RES/nyx-build-stamp"
# Read by the update check.
echo "$NYX_VERSION" > "$RES/nyx-version"

log "Signing (ad-hoc)"
xattr -cr "$APP"
codesign --force --deep -s - "$APP"
codesign --verify --deep --strict "$APP"

log "Writing dist"
OUT_APP="$DIST/$APP_NAME.app"
DMG="$DIST/NYX-Browser-$NYX_VERSION.dmg"
rm -rf "$OUT_APP" "$DMG"
mv "$APP" "$OUT_APP"

STAGE="$WORK/dmg"
mkdir -p "$STAGE"
ditto "$OUT_APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "$APP_NAME" -srcfolder "$STAGE" -format UDZO -ov "$DMG"
rm -rf "$WORK"

log "Done"
du -sh "$OUT_APP" "$DMG"
