#!/usr/bin/env bash
# Launch Chromium in kiosk mode with uBlock Origin + Blackhole kiosk-bridge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${ROOT}/scripts/.chromium-profile"
UBLOCK_DIR="${ROOT}/extensions/ublock"
BRIDGE_DIR="${ROOT}/extensions/kiosk-bridge"
SHELL_URL="${BLACKHOLE_SHELL_URL:-http://127.0.0.1:3000/}"
POLICY_DIR="${PROFILE}/policies/managed"

mkdir -p "${PROFILE}" "${POLICY_DIR}"

find_browser() {
  local candidates=(
    "${BLACKHOLE_CHROMIUM:-}"
    chromium
    chromium-browser
    google-chrome
    google-chrome-stable
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
  local c
  for c in "${candidates[@]}"; do
    [[ -z "${c}" ]] && continue
    if [[ -x "${c}" ]]; then
      echo "${c}"
      return 0
    fi
    if command -v "${c}" >/dev/null 2>&1; then
      command -v "${c}"
      return 0
    fi
  done
  return 1
}

ensure_ublock() {
  if [[ -f "${UBLOCK_DIR}/manifest.json" ]]; then
    return 0
  fi
  echo "Downloading uBlock Origin (Chromium build)…"
  mkdir -p "${ROOT}/extensions"
  local tmp
  tmp="$(mktemp -d)"
  # Pin a known Chromium zip from uBlock Origin releases.
  local url="https://github.com/gorhill/uBlock/releases/download/1.62.0/uBlock0_1.62.0.chromium.zip"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${tmp}/ublock.zip"
  else
    wget -qO "${tmp}/ublock.zip" "${url}"
  fi
  rm -rf "${UBLOCK_DIR}"
  mkdir -p "${UBLOCK_DIR}"
  unzip -q "${tmp}/ublock.zip" -d "${tmp}/extracted"
  # Zip may contain a single top-level folder.
  if [[ -f "${tmp}/extracted/manifest.json" ]]; then
    cp -R "${tmp}/extracted/." "${UBLOCK_DIR}/"
  else
    local inner
    inner="$(find "${tmp}/extracted" -maxdepth 2 -name manifest.json | head -n1)"
    cp -R "$(dirname "${inner}")/." "${UBLOCK_DIR}/"
  fi
  rm -rf "${tmp}"
  echo "uBlock Origin installed at ${UBLOCK_DIR}"
}

# Keep Manifest V2 available for full uBlock Origin while Chromium still allows it.
cat > "${POLICY_DIR}/blackhole.json" <<'EOF'
{
  "ExtensionManifestV2Availability": 2,
  "ExtensionInstallForcelist": [],
  "DefaultBrowserSettingEnabled": false
}
EOF

BROWSER="$(find_browser)" || {
  echo "No Chromium/Chrome binary found. Set BLACKHOLE_CHROMIUM to the path." >&2
  exit 1
}

ensure_ublock

EXT_PATHS="${UBLOCK_DIR},${BRIDGE_DIR}"

echo "Browser: ${BROWSER}"
echo "Shell:   ${SHELL_URL}"
echo "Profile: ${PROFILE}"
echo "Extensions: ${EXT_PATHS}"

exec "${BROWSER}" \
  --user-data-dir="${PROFILE}" \
  --disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled \
  --load-extension="${EXT_PATHS}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --kiosk "${SHELL_URL}"
