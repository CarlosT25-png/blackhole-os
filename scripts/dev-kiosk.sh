#!/usr/bin/env bash
# Launch Chromium in kiosk mode with uBlock Origin + Blackhole kiosk-bridge.
#
# IMPORTANT: Official Google Chrome 137+ ignores --load-extension.
# This script prefers Chromium / Chrome for Testing so extensions actually load.
#
# Do not run with sudo. Chrome as root on macOS often paints a blank white
# window, and it root-owns the profile so later non-sudo runs break.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${ROOT}/scripts/.chromium-profile"
UBLOCK_DIR="${ROOT}/extensions/ublock"
BRIDGE_DIR="${ROOT}/extensions/kiosk-bridge"
CFT_DIR="${ROOT}/scripts/chrome-for-testing"
SHELL_URL="${BLACKHOLE_SHELL_URL:-http://127.0.0.1:3000/}"
POLICY_DIR="${PROFILE}/policies/managed"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Do not run the desktop kiosk with sudo." >&2
  echo "Chrome as root usually shows a blank white window." >&2
  echo "  ./scripts/dev-kiosk.sh" >&2
  exit 1
fi

if [[ -e "${PROFILE}" ]] && find "${PROFILE}" -user root -print -quit 2>/dev/null | grep -q .; then
  echo "The kiosk Chrome profile has root-owned files from a previous sudo run." >&2
  echo "Fix ownership, then retry without sudo:" >&2
  echo "  sudo chown -R \"${USER}\" \"${PROFILE}\"" >&2
  exit 1
fi

shell_http_ok() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "${SHELL_URL}" 2>/dev/null || true)"
  [[ "${code}" == "200" || "${code}" == "304" ]]
}

ensure_shell() {
  if shell_http_ok; then
    return 0
  fi

  local port="3000"
  if [[ "${SHELL_URL}" =~ :([0-9]+) ]]; then
    port="${BASH_REMATCH[1]}"
  fi

  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Something is listening on :${port} but ${SHELL_URL} is not serving." >&2
    echo "The Next.js dev server is likely stuck. Restart it, then retry:" >&2
    echo "  cd apps/shell && npm run dev" >&2
    exit 1
  fi

  echo "Shell is not running at ${SHELL_URL}. Starting Next.js…"
  if [[ ! -d "${ROOT}/apps/shell/node_modules" ]]; then
    (cd "${ROOT}/apps/shell" && npm install)
  fi
  (cd "${ROOT}/apps/shell" && npm run dev) >/tmp/blackhole-shell-dev.log 2>&1 &
  disown || true

  local i
  for i in $(seq 1 60); do
    if shell_http_ok; then
      return 0
    fi
    sleep 0.5
  done

  echo "Shell did not become ready at ${SHELL_URL}." >&2
  echo "Last log lines:" >&2
  tail -n 20 /tmp/blackhole-shell-dev.log >&2 || true
  echo "Start it yourself:  cd apps/shell && npm run dev" >&2
  exit 1
}

mkdir -p "${PROFILE}" "${POLICY_DIR}" "${CFT_DIR}"
ensure_shell

is_branded_chrome() {
  local bin="$1"
  case "${bin}" in
    *Google\ Chrome*|*google-chrome*) return 0 ;;
    *) return 1 ;;
  esac
}

find_cft_binary() {
  local candidate
  for candidate in \
    "${CFT_DIR}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
    "${CFT_DIR}/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
    "${CFT_DIR}/chrome-linux64/chrome" \
    "${CFT_DIR}/chrome-win64/chrome.exe"
  do
    if [[ -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

ensure_chrome_for_testing() {
  local existing
  if existing="$(find_cft_binary)"; then
    echo "${existing}"
    return 0
  fi

  local os arch platform zip_name url tmp
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}-${arch}" in
    Darwin-arm64) platform="mac-arm64"; zip_name="chrome-mac-arm64.zip" ;;
    Darwin-x86_64) platform="mac-x64"; zip_name="chrome-mac-x64.zip" ;;
    Linux-x86_64) platform="linux64"; zip_name="chrome-linux64.zip" ;;
    *)
      echo "No Chrome for Testing package for ${os}/${arch}." >&2
      return 1
      ;;
  esac

  echo "Downloading Chrome for Testing (${platform}) so --load-extension works…" >&2
  tmp="$(mktemp -d)"
  url="$(
    python3 - <<PY
import json, urllib.request
data = json.load(urllib.request.urlopen(
  "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
  timeout=30,
))
downloads = data["channels"]["Stable"]["downloads"]["chrome"]
for item in downloads:
  if item.get("platform") == "${platform}":
    print(item["url"])
    break
else:
  raise SystemExit("platform not found")
PY
  )"
  curl -fsSL "${url}" -o "${tmp}/${zip_name}"
  unzip -q "${tmp}/${zip_name}" -d "${CFT_DIR}"
  rm -rf "${tmp}"
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "${CFT_DIR}" 2>/dev/null || true
  fi
  find_cft_binary
}

find_browser() {
  local candidates=(
    "${BLACKHOLE_CHROMIUM:-}"
    "$(find_cft_binary 2>/dev/null || true)"
    chromium
    chromium-browser
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    google-chrome
    google-chrome-stable
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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
  mkdir -p "${ROOT}/extensions"
  local need_fetch=0
  if [[ ! -f "${UBLOCK_DIR}/manifest.json" ]]; then
    need_fetch=1
  else
    # Chrome for Testing / modern Chromium reject Manifest V2.
    local mv
    mv="$(python3 -c "import json; print(json.load(open('${UBLOCK_DIR}/manifest.json')).get('manifest_version', 0))")"
    if [[ "${mv}" != "3" ]]; then
      echo "Replacing Manifest V2 uBlock with uBlock Origin Lite (MV3)…" >&2
      need_fetch=1
    fi
  fi
  if [[ "${need_fetch}" -eq 0 ]]; then
    return 0
  fi

  echo "Downloading uBlock Origin Lite (MV3)…" >&2
  local tmp ver url
  tmp="$(mktemp -d)"
  ver="2026.825.1619"
  url="https://github.com/uBlockOrigin/uBOL-home/releases/download/${ver}/uBOLite_${ver}.chromium.zip"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${tmp}/ublock.zip"
  else
    wget -qO "${tmp}/ublock.zip" "${url}"
  fi
  rm -rf "${UBLOCK_DIR}"
  mkdir -p "${UBLOCK_DIR}"
  unzip -q "${tmp}/ublock.zip" -d "${tmp}/extracted"
  if [[ -f "${tmp}/extracted/manifest.json" ]]; then
    cp -R "${tmp}/extracted/." "${UBLOCK_DIR}/"
  else
    local inner
    inner="$(find "${tmp}/extracted" -maxdepth 3 -name manifest.json | head -n1)"
    cp -R "$(dirname "${inner}")/." "${UBLOCK_DIR}/"
  fi
  rm -rf "${tmp}"
  echo "uBlock Origin Lite installed at ${UBLOCK_DIR}" >&2
}

# Full kiosk policies — mirror chromium-kiosk.sh (password manager / popups off).
python3 - "$POLICY_DIR" "$PROFILE" <<'PY'
import json
import sys
from pathlib import Path

policy_dir = Path(sys.argv[1])
profile = Path(sys.argv[2])
policy_dir.mkdir(parents=True, exist_ok=True)
(profile / "Default").mkdir(parents=True, exist_ok=True)

policy = {
  "DefaultBrowserSettingEnabled": False,
  "BrowserSignin": 0,
  "SyncDisabled": True,
  "PasswordManagerEnabled": False,
  "PasswordLeakDetectionEnabled": False,
  "PasswordSharingEnabled": False,
  "AutofillAddressEnabled": False,
  "AutofillCreditCardEnabled": False,
  "TranslateEnabled": False,
  "DefaultNotificationsSetting": 2,
  "DefaultPopupsSetting": 2,
  "DefaultGeolocationSetting": 2,
  "DefaultMediaStreamSetting": 2,
  "PromptForDownloadLocation": False,
  "DownloadRestrictions": 3,
  "BookmarkBarEnabled": False,
  "SavingBrowserHistoryDisabled": True,
  "PromotionalTabsEnabled": False,
  "MetricsReportingEnabled": False,
  "SearchSuggestEnabled": False,
  "SpellCheckServiceEnabled": False,
}
(policy_dir / "blackhole.json").write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")

prefs_path = profile / "Default" / "Preferences"
prefs = {}
if prefs_path.exists():
  try:
    loaded = json.loads(prefs_path.read_text(encoding="utf-8"))
    if isinstance(loaded, dict):
      prefs = loaded
  except json.JSONDecodeError:
    prefs = {}
prefs["credentials_enable_service"] = False
profile_prefs = prefs.get("profile")
if not isinstance(profile_prefs, dict):
  profile_prefs = {}
profile_prefs["password_manager_enabled"] = False
prefs["profile"] = profile_prefs
prefs_path.write_text(json.dumps(prefs, indent=2) + "\n", encoding="utf-8")
PY

BROWSER="$(find_browser)" || {
  echo "No Chromium/Chrome binary found. Set BLACKHOLE_CHROMIUM to the path." >&2
  exit 1
}

if is_branded_chrome "${BROWSER}"; then
  echo "Google Chrome ignores --load-extension (Chrome 137+)."
  echo "Switching to Chrome for Testing so kiosk-bridge + uBlock can load…"
  if BROWSER="$(ensure_chrome_for_testing)"; then
    echo "Using Chrome for Testing."
  else
    echo "ERROR: Could not install Chrome for Testing." >&2
    echo "Install Chromium, or set BLACKHOLE_CHROMIUM to a non-branded binary." >&2
    exit 1
  fi
fi

ensure_ublock

EXT_PATHS="${UBLOCK_DIR},${BRIDGE_DIR}"

echo "Browser: ${BROWSER}"
echo "Shell:   ${SHELL_URL}"
echo "Profile: ${PROFILE}"
echo "Extensions: ${EXT_PATHS}"
echo
echo "In the kiosk window, open chrome://extensions — you should see"
echo "Blackhole Kiosk Bridge and uBlock Origin Lite. Then open an app;"
echo "Esc / the top-right Blackhole chip return home."

exec "${BROWSER}" \
  --user-data-dir="${PROFILE}" \
  --disable-features=DisableLoadExtensionCommandLineSwitch,PasswordManagerOnboarding,PasswordImport,AutofillServerCommunication,Translate \
  --enable-unsafe-extension-debugging \
  --load-extension="${EXT_PATHS}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --enable-accelerated-video-decode \
  --kiosk "${SHELL_URL}"
