#!/bin/bash
# Publishes the dmg from dist as a GitHub release and updates docs/latest.json.
# Run ./build.sh first. Needs the GitHub CLI: brew install gh && gh auth login
set -euo pipefail

REPO="skytninja/NYX-browser"
ROOT="$(cd "$(dirname "$0")" && pwd)"
NYX_VERSION="$(sed -n 's/^NYX_VERSION="\(.*\)"$/\1/p' "$ROOT/build.sh")"
FF_VERSION="$(sed -n 's/^FF_VERSION="\(.*\)"$/\1/p' "$ROOT/build.sh")"
DMG="$ROOT/dist/NYX-Browser-$NYX_VERSION.dmg"
TAG="v$NYX_VERSION"

[ -f "$DMG" ] || { echo "No $DMG. Run ./build.sh first." >&2; exit 1; }
BUILT="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$ROOT/dist/NYX Browser.app/Contents/Info.plist")"
[ "$BUILT" = "$NYX_VERSION" ] || { echo "dist holds $BUILT, build.sh says $NYX_VERSION. Rebuild." >&2; exit 1; }
command -v gh >/dev/null || { echo "Install the GitHub CLI: brew install gh && gh auth login" >&2; exit 1; }

SHA256="$(shasum -a 256 "$DMG" | cut -d' ' -f1)"
SIZE="$(stat -f %z "$DMG")"
echo "Release $TAG (Firefox $FF_VERSION), $DMG"
echo "sha256 $SHA256"
read -r -p "Publish to github.com/$REPO? [y/N] " answer
[ "$answer" = "y" ] || { echo "Cancelled."; exit 0; }

gh release create "$TAG" "$DMG" --repo "$REPO" --title "NYX Browser $NYX_VERSION" \
  --notes "На основе Firefox $FF_VERSION. SHA-256: \`$SHA256\`"

# Written only after the release exists, so nobody is told about a file that isn't there yet.
cat > "$ROOT/docs/latest.json" <<EOF
{
  "version": "$NYX_VERSION",
  "firefox": "$FF_VERSION",
  "date": "$(date +%Y-%m-%d)",
  "dmg": "https://github.com/$REPO/releases/download/$TAG/NYX-Browser-$NYX_VERSION.dmg",
  "size": $SIZE,
  "sha256": "$SHA256"
}
EOF
echo
echo "Release is up. Users learn about it once the site has it:"
echo "  git add docs/latest.json && git commit -m \"Release $TAG\" && git push"
