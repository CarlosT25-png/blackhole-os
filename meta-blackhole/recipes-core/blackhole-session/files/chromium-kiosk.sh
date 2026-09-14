#!/bin/sh
# Chromium kiosk launcher for Blackhole OS.
set -eu

SHELL_URL="${BLACKHOLE_SHELL_URL:-http://127.0.0.1/}"
EXT_DIR="/usr/share/chromium/extensions"
PROFILE_DIR="/var/lib/blackhole/chromium"
POLICY_DIR="/etc/chromium/policies/managed"

mkdir -p "${PROFILE_DIR}" "${POLICY_DIR}"

cat > "${POLICY_DIR}/blackhole.json" <<'EOF'
{
  "ExtensionManifestV2Availability": 2,
  "DefaultBrowserSettingEnabled": false,
  "BrowserSignin": 0,
  "SyncDisabled": true
}
EOF

EXT_PATHS="${EXT_DIR}/ublock,${EXT_DIR}/kiosk-bridge"

# Prefer chromium-bin from meta-browser when present.
CHROME="chromium"
if command -v chromium-bin >/dev/null 2>&1; then
  CHROME="chromium-bin"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROME="chromium-browser"
fi

exec "${CHROME}" \
  --ozone-platform=wayland \
  --user-data-dir="${PROFILE_DIR}" \
  --disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled \
  --load-extension="${EXT_PATHS}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  --kiosk "${SHELL_URL}"
