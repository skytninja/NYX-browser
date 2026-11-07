#!/bin/bash
# Rebrands Firefox's two omni.ja archives and adds NYX's pages and keys. Shared by both builds.
# Usage: brand_omni.sh <Firefox resources dir: holds omni.ja and browser/omni.ja> <mac|win> <work dir>
set -euo pipefail
RES="$1"
PLATFORM="$2"
WORK="$3"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANDING="$ROOT/branding/generated"
source "$ROOT/versions.sh"

OMNI="$WORK/omni"
OMNI_TOOLKIT="$WORK/omni-toolkit"
rm -rf "$OMNI" "$OMNI_TOOLKIT"
mkdir -p "$OMNI" "$OMNI_TOOLKIT"
# Firefox's omni.ja has a non-standard layout: unzip warns and exits 1-2 but extracts correctly.
unzip -qq "$RES/browser/omni.ja" -d "$OMNI" 2>/dev/null || [ $? -le 2 ]
unzip -qq "$RES/omni.ja" -d "$OMNI_TOOLKIT" 2>/dev/null || [ $? -le 2 ]
python3 -I "$ROOT/branding/patch_omni.py" "$OMNI" "$OMNI_TOOLKIT" "$ROOT" "$PLATFORM"
BRAND_FTL="$OMNI/localization/$FF_LOCALE/branding/brand.ftl"
BRAND_PROPS="$OMNI/chrome/$FF_LOCALE/locale/branding/brand.properties"
BRAND_DIR="$OMNI/chrome/browser/content/branding"
[ -f "$BRAND_FTL" ] && [ -f "$BRAND_PROPS" ] && [ -d "$BRAND_DIR" ] || { echo "omni.ja layout changed" >&2; exit 1; }
cat > "$BRAND_FTL" <<FTL
-brand-shorter-name = NYX
-brand-short-name = NYX Browser
-brand-shortcut-name = NYX Browser
-brand-full-name = NYX Browser
-brand-product-name = NYX Browser
-vendor-short-name = NYX
trademarkInfo = { "" }
FTL
cat > "$BRAND_PROPS" <<PROPS
brandShorterName=NYX
brandShortName=NYX Browser
brandFullName=NYX Browser
PROPS
for px in 16 32 48 64 128; do cp "$BRANDING/logo$px.png" "$BRAND_DIR/icon$px.png"; done
cp "$BRANDING/logo210.png" "$BRAND_DIR/about-logo.png"
cp "$BRANDING/logo420.png" "$BRAND_DIR/about-logo@2x.png"
cp "$BRANDING/logo210.png" "$BRAND_DIR/about-logo-private.png"
cp "$BRANDING/logo420.png" "$BRAND_DIR/about-logo-private@2x.png"
cp "$BRANDING/logo210.png" "$BRAND_DIR/about.png"
cp "$BRANDING/logo.svg" "$BRAND_DIR/about-logo.svg"
cp "$BRANDING/document.ico" "$BRAND_DIR/document.ico"
rm "$RES/browser/omni.ja" "$RES/omni.ja"
(cd "$OMNI" && zip -qr9XD "$RES/browser/omni.ja" .)
(cd "$OMNI_TOOLKIT" && zip -qr9XD "$RES/omni.ja" .)
rm -rf "$OMNI" "$OMNI_TOOLKIT"
