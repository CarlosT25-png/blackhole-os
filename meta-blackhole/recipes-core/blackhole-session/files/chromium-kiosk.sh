#!/bin/sh
# Chromium kiosk launcher for Blackhole OS.
set -eu

SHELL_URL="${BLACKHOLE_SHELL_URL:-http://127.0.0.1/}"
EXT_DIR="/usr/share/chromium/extensions"
PROFILE_DIR="/var/lib/blackhole/chromium"
POLICY_DIR="/etc/chromium/policies/managed"
# Chrome for Testing also reads Google Chrome policy paths.
POLICY_DIR_CFT="/etc/opt/chrome/policies/managed"
PROFILE_POLICY_DIR="${PROFILE_DIR}/policies/managed"
DATA_DIR="${BLACKHOLE_DATA:-/var/lib/blackhole}"
# TV-friendly zoom (1.0 = 100%). Override with BLACKHOLE_UI_SCALE=1.1 etc.
UI_SCALE="${BLACKHOLE_UI_SCALE:-1.0}"

mkdir -p "${PROFILE_DIR}/Default" "${POLICY_DIR}" "${POLICY_DIR_CFT}" "${PROFILE_POLICY_DIR}"

python3 - "${DATA_DIR}" "${POLICY_DIR}" "${POLICY_DIR_CFT}" "${PROFILE_POLICY_DIR}" "${PROFILE_DIR}" <<'PY'
import json
import sys
from pathlib import Path

data_dir, *policy_dirs = sys.argv[1:-1]
profile_dir = Path(sys.argv[-1])
settings_path = Path(data_dir) / "settings.json"
settings = {}
try:
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
except Exception:
    settings = {}

adblock = settings.get("adblock") if isinstance(settings.get("adblock"), dict) else {}
filtering = str(adblock.get("filtering") or "optimal")
if filtering not in {"none", "basic", "optimal", "complete"}:
    filtering = "optimal"
extension_id = str(adblock.get("extensionId") or "").strip()

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
if extension_id:
    policy["3rdparty"] = {
        "extensions": {
            extension_id: {
                "defaultFiltering": filtering,
                "disableFirstRunPage": True,
            }
        }
    }

payload = json.dumps(policy, indent=2) + "\n"
for raw in policy_dirs:
    path = Path(raw)
    try:
        path.mkdir(parents=True, exist_ok=True)
        (path / "blackhole.json").write_text(payload, encoding="utf-8")
    except OSError:
        pass

prefs_path = profile_dir / "Default" / "Preferences"
try:
    prefs_path.parent.mkdir(parents=True, exist_ok=True)
    prefs = {}
    if prefs_path.exists():
        try:
            loaded = json.loads(prefs_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                prefs = loaded
        except json.JSONDecodeError:
            prefs = {}
    prefs["credentials_enable_service"] = False
    profile = prefs.get("profile")
    if not isinstance(profile, dict):
        profile = {}
    profile["password_manager_enabled"] = False
    prefs["profile"] = profile
    prefs_path.write_text(json.dumps(prefs, indent=2) + "\n", encoding="utf-8")
except OSError:
    pass
PY

EXT_PATHS="${EXT_DIR}/ublock,${EXT_DIR}/kiosk-bridge"

# Prefer prebuilt Chrome for Testing wrapper, then meta-browser builds.
CHROME=""
for candidate in chromium-bin chromium chromium-browser google-chrome-stable; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    CHROME="${candidate}"
    break
  fi
done
if [ -z "${CHROME}" ] && [ -x /opt/chromium/chrome ]; then
  CHROME="/opt/chromium/chrome"
fi
if [ -z "${CHROME}" ]; then
  echo "No Chromium binary found" >&2
  exit 1
fi

# Prebuilt Chrome often needs --no-sandbox on embedded images without user namespaces.
EXTRA_ARGS=""
case "${CHROME}" in
  chromium-bin|/opt/chromium/chrome)
    # --disable-infobars hides the "Chrome for Testing" banner.
    EXTRA_ARGS="--no-sandbox --disable-infobars"
    ;;
esac

ARCH="$(uname -m)"
VIDEO_FEATURES="UseOzonePlatform,CanvasOopRasterization"
case "${ARCH}" in
  x86_64|amd64)
    VIDEO_FEATURES="${VIDEO_FEATURES},VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,VaapiIgnoreDriverChecks"
    ;;
  *)
    VIDEO_FEATURES="${VIDEO_FEATURES},V4L2VideoDecoder,V4L2SliceVideoDecoder"
    ;;
esac

exec "${CHROME}" \
  ${EXTRA_ARGS} \
  --ozone-platform=wayland \
  --enable-features="${VIDEO_FEATURES}" \
  --disable-features=PasswordManagerOnboarding,PasswordImport,AutofillServerCommunication,Translate \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --enable-accelerated-video-decode \
  --force-device-scale-factor="${UI_SCALE}" \
  --user-data-dir="${PROFILE_DIR}" \
  --load-extension="${EXT_PATHS}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --check-for-update-interval=31536000 \
  --kiosk "${SHELL_URL}"
