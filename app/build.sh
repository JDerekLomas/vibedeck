#!/bin/bash
# Build vibedeck.app (native Swift shell) and install to /Applications.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$HERE/../dist"
APP="$DIST/vibedeck.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "compiling…"
swiftc -O -framework Cocoa -framework WebKit "$HERE/main.swift" -o "$APP/Contents/MacOS/vibedeck"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>vibedeck</string>
  <key>CFBundleDisplayName</key><string>vibedeck</string>
  <key>CFBundleIdentifier</key><string>com.vibedeck.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>vibedeck</string>
  <key>CFBundleIconFile</key><string>vibedeck.icns</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict></plist>
EOF

# Icon: app/icon.png (1024x1024) -> icns
if [ -f "$HERE/icon.png" ]; then
  echo "building icon…"
  ICONSET="$DIST/vibedeck.iconset"
  rm -rf "$ICONSET"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$HERE/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$HERE/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/vibedeck.icns"
  rm -rf "$ICONSET"
fi

codesign --force --sign - "$APP" 2>/dev/null || true

TARGET="/Applications/vibedeck.app"
if [ -w "/Applications" ]; then
  rm -rf "$TARGET"; cp -R "$APP" "$TARGET"
else
  TARGET="$HOME/Applications/vibedeck.app"
  mkdir -p "$HOME/Applications"; rm -rf "$TARGET"; cp -R "$APP" "$TARGET"
fi
echo "installed: $TARGET"
