#!/usr/bin/env python3
"""Blackhole OS local API — apps, launch, settings, RAUC updates (stdlib only)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import select
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = Path(os.environ.get("BLACKHOLE_DATA", ROOT / "data"))
BUNDLED_CATALOG = Path(
    os.environ.get("BLACKHOLE_CATALOG", ROOT / "catalog" / "apps.json")
)
BUNDLED_SHELL = Path(
    os.environ.get("BLACKHOLE_BUNDLED_SHELL", "/usr/share/blackhole/shell")
)
SHELL_URL = os.environ.get("BLACKHOLE_SHELL_URL", "http://127.0.0.1:3000")
DEFAULT_CHANNEL = os.environ.get(
    "BLACKHOLE_CHANNEL_URL",
    "https://github.com/CarlosT25-png/blackhole-os/releases/latest/download/channel.json",
)
DEV_MODE = os.environ.get("BLACKHOLE_DEV", "1") == "1"
DEFAULT_CATALOG_URL = os.environ.get(
    "BLACKHOLE_CATALOG_URL",
    "https://blackhole-os-panel.carlostorres.dev/catalog/apps.json",
)
DEFAULT_SHELL_UPDATE_URL = os.environ.get(
    "BLACKHOLE_SHELL_UPDATE_URL",
    "https://blackhole-os-panel.carlostorres.dev",
).rstrip("/")
HOST = os.environ.get("BLACKHOLE_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLACKHOLE_PORT", "8081"))
VERSION = os.environ.get("BLACKHOLE_VERSION", "0.1.0-dev")
MACHINE = os.environ.get("BLACKHOLE_MACHINE", "desktop")

DEFAULT_SETTINGS: dict[str, Any] = {
    "channelUrl": DEFAULT_CHANNEL,
    "catalogUrl": DEFAULT_CATALOG_URL,
    "shellUrl": DEFAULT_SHELL_UPDATE_URL,
    "display": {
        "scale": 100,
        "reducedMotion": False,
        "aspect": "auto",
        "refreshHz": "auto",
    },
    "adblock": {
        "filtering": "optimal",
        "extensionId": "",
    },
    "network": {
        "ssid": "",
        "password": "",
        "mode": "dhcp",
    },
    "time": {
        "timezone": "UTC",
        "ntp": True,
        "autoTimezone": True,
        "hour12": True,
    },
    "power": {
        "idleSec": 0,
    },
}

ASPECT_MODES = {
    "auto": "preferred",
    "16:9": "1920x1080",
    "16:10": "1920x1200",
    "4:3": "1600x1200",
}
REFRESH_RATES = {"auto", 50, 60, 75, 120, "50", "60", "75", "120"}
FILTERING_MODES = {"none", "basic", "optimal", "complete"}
IDLE_SECONDS = {0, 300, 900, 1800, 3600}
ZONE_NAME_RE = re.compile(r"^(UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+)$")
ZONE_REGION_ORDER = (
    "UTC",
    "America",
    "Europe",
    "Asia",
    "Pacific",
    "Australia",
    "Africa",
    "Atlantic",
    "Indian",
    "Antarctica",
    "Etc",
)
INPUT_EVENT_FORMAT = struct.Struct("llHHi")
EV_KEY = 0x01
EV_REL = 0x02
EV_ABS = 0x03
POWER_LOCK = threading.Lock()
_POWER: dict[str, Any] = {
    "sleeping": False,
    "last_activity": time.monotonic(),
}
CHROME_POLICY_BASE: dict[str, Any] = {
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
WESTON_OUTPUT_NAMES = ("HDMI-A-1", "HDMI-A-2", "DP-1", "DSI-1", "eDP-1")
PLACEHOLDER_CHANNEL_URLS = {
    "",
    "https://github.com/example/blackhole-os/releases/latest/download/channel.json",
}
GEO_TZ_URLS = (
    "https://ipapi.co/json/",
    "https://ipwho.is/",
    "https://worldtimeapi.org/api/ip",
)


def data_dir() -> Path:
    path = DEFAULT_DATA
    path.mkdir(parents=True, exist_ok=True)
    return path


def apps_file() -> Path:
    return data_dir() / "apps.json"


def catalog_cache_file() -> Path:
    return data_dir() / "catalog.json"


def shell_overlay_dir() -> Path:
    return data_dir() / "shell"


def shell_version_file() -> Path:
    return data_dir() / "shell-version.json"


def launch_file() -> Path:
    return data_dir() / "launch.json"


def settings_file() -> Path:
    return data_dir() / "settings.json"


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def save_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_settings() -> dict[str, Any]:
    stored = load_json(settings_file(), {})
    if not isinstance(stored, dict):
        stored = {}
    merged = deep_merge(DEFAULT_SETTINGS, stored)
    if str(merged.get("channelUrl") or "") in PLACEHOLDER_CHANNEL_URLS:
        merged["channelUrl"] = DEFAULT_CHANNEL
    return merged


def save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    merged = deep_merge(DEFAULT_SETTINGS, settings)
    display = merged.get("display")
    if isinstance(display, dict):
        aspect = str(display.get("aspect") or "auto")
        if aspect not in ASPECT_MODES:
            aspect = "auto"
        display["aspect"] = aspect
        hz = display.get("refreshHz", "auto")
        if hz not in REFRESH_RATES:
            hz = "auto"
        display["refreshHz"] = "auto" if hz == "auto" else int(hz)
        try:
            scale = int(display.get("scale") or 100)
        except (TypeError, ValueError):
            scale = 100
        display["scale"] = scale
        display["reducedMotion"] = bool(display.get("reducedMotion"))
        merged["display"] = display
    adblock = merged.get("adblock")
    if isinstance(adblock, dict):
        filtering = str(adblock.get("filtering") or "optimal")
        if filtering not in FILTERING_MODES:
            filtering = "optimal"
        adblock["filtering"] = filtering
        adblock["extensionId"] = str(adblock.get("extensionId") or "").strip()
        merged["adblock"] = adblock
    time_cfg = merged.get("time")
    if isinstance(time_cfg, dict):
        timezone = str(time_cfg.get("timezone") or "UTC").strip()
        if not ZONE_NAME_RE.match(timezone):
            timezone = "UTC"
        time_cfg["timezone"] = timezone
        time_cfg["ntp"] = bool(time_cfg.get("ntp", True))
        time_cfg["autoTimezone"] = bool(time_cfg.get("autoTimezone", True))
        time_cfg["hour12"] = bool(time_cfg.get("hour12", True))
        merged["time"] = time_cfg
    power = merged.get("power")
    if isinstance(power, dict):
        try:
            idle_sec = int(power.get("idleSec") or 0)
        except (TypeError, ValueError):
            idle_sec = 0
        if idle_sec not in IDLE_SECONDS:
            idle_sec = 0
        power["idleSec"] = idle_sec
        merged["power"] = power
    if str(merged.get("channelUrl") or "") in PLACEHOLDER_CHANNEL_URLS:
        merged["channelUrl"] = DEFAULT_CHANNEL
    save_json(settings_file(), merged)
    return merged


def persist_settings(patch: dict[str, Any]) -> dict[str, Any]:
    previous = load_settings()
    saved = save_settings(deep_merge(previous, patch))
    apply_runtime_settings(previous, saved)
    return saved


def weston_ini_path() -> Path:
    return data_dir() / "weston.ini"


def weston_config_dir() -> Path:
    return data_dir() / "weston"


def weston_mode_line(display: dict[str, Any]) -> str:
    aspect = str(display.get("aspect") or "auto")
    hz = display.get("refreshHz", "auto")
    size = ASPECT_MODES.get(aspect, "preferred")
    if size == "preferred":
        if hz == "auto":
            return "preferred"
        return f"preferred@{int(hz)}"
    if hz == "auto":
        return size
    return f"{size}@{int(hz)}"


def weston_repaint_window(display: dict[str, Any]) -> int:
    hz = display.get("refreshHz", "auto")
    if hz == "auto":
        return 16
    try:
        rate = int(hz)
    except (TypeError, ValueError):
        return 16
    if rate <= 0:
        return 16
    return max(8, min(22, round(1000 / rate)))


def render_weston_ini(display: dict[str, Any]) -> str:
    mode = weston_mode_line(display)
    repaint = weston_repaint_window(display)
    lines = [
        "[core]",
        "idle-time=0",
        "require-input=false",
        "shell=kiosk-shell.so",
        f"repaint-window={repaint}",
        "",
        "[shell]",
        "locking=false",
        "panel-position=none",
        "background-color=0xFF06070B",
        "",
        "[libinput]",
        "enable-tap=true",
        "",
    ]
    for name in WESTON_OUTPUT_NAMES:
        lines.extend(["[output]", f"name={name}", f"mode={mode}", ""])
    return "\n".join(lines) + "\n"


def apply_weston_display(settings: dict[str, Any], restart: bool) -> None:
    display = settings.get("display")
    if not isinstance(display, dict):
        return
    payload = render_weston_ini(display)
    targets = [weston_ini_path(), weston_config_dir() / "weston.ini"]
    for path in targets:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(payload, encoding="utf-8")
        except OSError:
            pass
    etc = Path("/etc/xdg/weston/weston.ini")
    if etc.parent.is_dir():
        try:
            etc.write_text(payload, encoding="utf-8")
        except OSError:
            pass
    if not restart or DEV_MODE:
        return
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return
    try:
        subprocess.run(
            [systemctl, "restart", "weston.service"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def chrome_policy_dirs() -> list[Path]:
    dirs: list[Path] = []
    env_dir = os.environ.get("BLACKHOLE_CHROME_POLICY_DIR")
    if env_dir:
        dirs.append(Path(env_dir))
    dirs.extend(
        [
            Path("/etc/chromium/policies/managed"),
            Path("/etc/opt/chrome/policies/managed"),
            data_dir() / "chromium" / "policies" / "managed",
            ROOT / "scripts" / ".chromium-profile" / "policies" / "managed",
        ]
    )
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in dirs:
        resolved = path
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(resolved)
    return unique


def write_chrome_policies(settings: dict[str, Any]) -> None:
    policy = dict(CHROME_POLICY_BASE)
    adblock = settings.get("adblock") if isinstance(settings.get("adblock"), dict) else {}
    filtering = str(adblock.get("filtering") or "optimal")
    if filtering not in FILTERING_MODES:
        filtering = "optimal"
    extension_id = str(adblock.get("extensionId") or "").strip()
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
    for directory in chrome_policy_dirs():
        try:
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "blackhole.json").write_text(payload, encoding="utf-8")
        except OSError:
            continue
    seed_chromium_preferences()


def seed_chromium_preferences() -> None:
    candidates = [
        data_dir() / "chromium" / "Default" / "Preferences",
        ROOT / "scripts" / ".chromium-profile" / "Default" / "Preferences",
    ]
    for prefs_path in candidates:
        try:
            prefs_path.parent.mkdir(parents=True, exist_ok=True)
            prefs: dict[str, Any] = {}
            if prefs_path.exists():
                loaded = load_json(prefs_path, {})
                if isinstance(loaded, dict):
                    prefs = loaded
            prefs["credentials_enable_service"] = False
            profile = prefs.get("profile")
            if not isinstance(profile, dict):
                profile = {}
            profile["password_manager_enabled"] = False
            prefs["profile"] = profile
            save_json(prefs_path, prefs)
        except OSError:
            continue


def apply_runtime_settings(previous: dict[str, Any], saved: dict[str, Any]) -> None:
    write_chrome_policies(saved)
    prev_display = previous.get("display") if isinstance(previous.get("display"), dict) else {}
    new_display = saved.get("display") if isinstance(saved.get("display"), dict) else {}
    if (prev_display.get("aspect"), prev_display.get("refreshHz")) != (
        new_display.get("aspect"),
        new_display.get("refreshHz"),
    ):
        apply_weston_display(saved, restart=not DEV_MODE)
    prev_time = previous.get("time") if isinstance(previous.get("time"), dict) else {}
    new_time = saved.get("time") if isinstance(saved.get("time"), dict) else {}
    if (prev_time.get("timezone"), prev_time.get("ntp")) != (
        new_time.get("timezone"),
        new_time.get("ntp"),
    ):
        apply_time_settings(saved)
    if bool(new_time.get("autoTimezone", True)) and not bool(prev_time.get("autoTimezone")):
        threading.Thread(target=apply_auto_timezone, daemon=True).start()


def available_zone_names() -> list[str]:
    names: set[str] = set()
    try:
        from zoneinfo import available_timezones

        names.update(available_timezones())
    except Exception:
        pass
    root = Path("/usr/share/zoneinfo")
    skip_top = {"posix", "right", "posixrules"}
    if root.is_dir():
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            top = rel.split("/", 1)[0]
            if top in skip_top or rel.endswith(".tab") or rel.endswith(".list"):
                continue
            names.add(rel)
    names.add("UTC")
    return sorted(zone for zone in names if ZONE_NAME_RE.match(zone))


def grouped_timezones() -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for zone in available_zone_names():
        region = zone.split("/", 1)[0] if "/" in zone else zone
        grouped.setdefault(region, []).append(zone)
    ordered: dict[str, list[str]] = {}
    for region in ZONE_REGION_ORDER:
        if region in grouped:
            ordered[region] = grouped.pop(region)
    return ordered


def _zoneinfo(name: str):
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:
        return None


def current_clock(timezone_name: str) -> tuple[str, dict[str, int]]:
    tz = _zoneinfo(timezone_name)
    now = datetime.now(tz) if tz is not None else datetime.now().astimezone()
    now = now.replace(microsecond=0)
    return now.isoformat(), {
        "year": now.year,
        "month": now.month,
        "day": now.day,
        "hour": now.hour,
        "minute": now.minute,
    }


def timedatectl_show() -> dict[str, str]:
    binary = shutil.which("timedatectl")
    if not binary:
        return {}
    try:
        completed = _run_cmd([binary, "show"], timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    parsed: dict[str, str] = {}
    for line in (completed.stdout or "").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def parse_clock_string(value: str) -> str:
    text = value.strip().replace("T", " ")
    if text.endswith("Z"):
        text = text[:-1]
    text = re.sub(r"[+-]\d{2}:\d{2}$", "", text)
    text = text.split(".", 1)[0].strip()
    if re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$", text):
        text += ":00"
    if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", text):
        raise ValueError("Time must be YYYY-MM-DDTHH:MM[:SS]")
    return text


def kick_timesyncd() -> None:
    settings = load_settings()
    time_cfg = settings.get("time") if isinstance(settings.get("time"), dict) else {}
    if not bool(time_cfg.get("ntp", True)):
        return
    if DEV_MODE:
        return
    binary = shutil.which("timedatectl")
    if binary:
        try:
            _run_cmd([binary, "set-ntp", "true"], timeout=8)
        except (OSError, subprocess.TimeoutExpired):
            pass
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return
    try:
        _run_cmd([systemctl, "try-restart", "systemd-timesyncd.service"], timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _parse_geo_timezone(payload: Any) -> str | None:
    zone: Any = None
    if isinstance(payload, str):
        zone = payload.strip()
    elif isinstance(payload, dict):
        zone = payload.get("timezone")
        if isinstance(zone, dict):
            zone = zone.get("id") or zone.get("name")
        if not zone:
            zone = payload.get("time_zone")
    zone_name = str(zone or "").strip()
    if ZONE_NAME_RE.match(zone_name):
        return zone_name
    return None


def detect_timezone_from_network() -> str | None:
    headers = {"Accept": "application/json", "User-Agent": "blackholed/0.1"}
    for url in GEO_TZ_URLS:
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=8) as response:
                body = response.read().decode("utf-8", errors="replace")
        except (OSError, urllib.error.URLError, TimeoutError):
            continue
        try:
            payload: Any = json.loads(body)
        except json.JSONDecodeError:
            payload = body
        zone = _parse_geo_timezone(payload)
        if zone:
            return zone
    return None


def apply_auto_timezone() -> str | None:
    settings = load_settings()
    time_cfg = settings.get("time") if isinstance(settings.get("time"), dict) else {}
    if not bool(time_cfg.get("autoTimezone", True)):
        return None
    detected = detect_timezone_from_network()
    if not detected:
        return None
    if detected == str(time_cfg.get("timezone") or ""):
        return detected
    persist_settings({"time": {"timezone": detected}})
    return detected


def apply_time_settings(
    settings: dict[str, Any],
    *,
    set_clock: str | None = None,
) -> dict[str, Any]:
    time_cfg = settings.get("time") if isinstance(settings.get("time"), dict) else {}
    timezone = str(time_cfg.get("timezone") or "UTC")
    ntp = bool(time_cfg.get("ntp", True))
    if DEV_MODE:
        return {
            "ok": True,
            "backend": "dev",
            "message": "Desktop simulation",
        }
    binary = shutil.which("timedatectl")
    if not binary:
        return {
            "ok": False,
            "backend": "none",
            "message": "timedatectl not available",
        }
    try:
        tz_result = _run_cmd([binary, "set-timezone", timezone], timeout=8)
        if tz_result.returncode != 0:
            detail = (tz_result.stderr or tz_result.stdout or "timezone failed").strip()
            raise ValueError(detail)
        if set_clock:
            _run_cmd([binary, "set-ntp", "false"], timeout=8)
            clock_result = _run_cmd([binary, "set-time", set_clock], timeout=8)
            if clock_result.returncode != 0:
                detail = (clock_result.stderr or clock_result.stdout or "set-time failed").strip()
                raise ValueError(detail)
        else:
            ntp_result = _run_cmd(
                [binary, "set-ntp", "true" if ntp else "false"],
                timeout=8,
            )
            if ntp_result.returncode != 0:
                detail = (ntp_result.stderr or ntp_result.stdout or "set-ntp failed").strip()
                raise ValueError(detail)
            if ntp:
                kick_timesyncd()
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(str(exc)) from exc
    return {"ok": True, "backend": "timedatectl"}


def time_status(include_zones: bool = False) -> dict[str, Any]:
    settings = load_settings()
    time_cfg = settings.get("time") if isinstance(settings.get("time"), dict) else {}
    timezone = str(time_cfg.get("timezone") or "UTC")
    ntp = bool(time_cfg.get("ntp", True))
    auto_timezone = bool(time_cfg.get("autoTimezone", True))
    hour12 = bool(time_cfg.get("hour12", True))
    shown = timedatectl_show()
    backend = "timedatectl" if shown else ("dev" if DEV_MODE else "none")
    if shown.get("Timezone") and not auto_timezone:
        timezone = shown["Timezone"]
    synchronized = str(shown.get("NTPSynchronized") or "").lower() in {"yes", "1", "true"}
    ntp_active = str(shown.get("NTP") or "").lower() in {"yes", "1", "true"} if shown else ntp
    iso, clock = current_clock(timezone)
    online = bool(network_status(settings).get("connected"))
    if ntp and not online:
        sync_label = "waiting"
    elif ntp and synchronized:
        sync_label = "synced"
    elif ntp:
        sync_label = "pending"
    else:
        sync_label = "off"
    payload: dict[str, Any] = {
        "timezone": timezone,
        "ntp": ntp,
        "autoTimezone": auto_timezone,
        "ntpActive": ntp_active,
        "synchronized": synchronized,
        "sync": sync_label,
        "iso": iso,
        "clock": clock,
        "hour12": hour12,
        "networkOnline": online,
        "backend": backend,
    }
    if include_zones:
        payload["zones"] = grouped_timezones()
    return payload


def note_activity() -> None:
    with POWER_LOCK:
        _POWER["last_activity"] = time.monotonic()
        sleeping = bool(_POWER["sleeping"])
    if sleeping:
        apply_display_wake()


def _drm_connectors() -> list[Path]:
    root = Path("/sys/class/drm")
    if not root.is_dir():
        return []
    found: list[Path] = []
    for path in sorted(root.iterdir()):
        dpms = path / "dpms"
        if not dpms.exists() or "-" not in path.name:
            continue
        found.append(path)
    return found


def _set_drm_dpms(value: str) -> bool:
    wrote = False
    for path in _drm_connectors():
        try:
            (path / "dpms").write_text(f"{value}\n", encoding="utf-8")
            wrote = True
        except OSError:
            continue
    return wrote


def _vcgencmd_display_power(on: bool) -> bool:
    binary = shutil.which("vcgencmd")
    if not binary:
        return False
    try:
        completed = _run_cmd([binary, "display_power", "1" if on else "0"], timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return completed.returncode == 0


def apply_display_sleep() -> dict[str, Any]:
    with POWER_LOCK:
        _POWER["sleeping"] = True
    if DEV_MODE:
        return {
            "ok": True,
            "action": "sleep",
            "backend": "dev",
            "message": "Would sleep (desktop simulation)",
        }
    if _vcgencmd_display_power(False):
        return {
            "ok": True,
            "action": "sleep",
            "backend": "vcgencmd",
            "message": "Display off",
        }
    if _set_drm_dpms("Off"):
        return {
            "ok": True,
            "action": "sleep",
            "backend": "drm",
            "message": "Display off",
        }
    return {
        "ok": False,
        "action": "sleep",
        "backend": "none",
        "message": "Could not turn the display off",
    }


def apply_display_wake() -> dict[str, Any]:
    with POWER_LOCK:
        _POWER["sleeping"] = False
        _POWER["last_activity"] = time.monotonic()
    if DEV_MODE:
        return {
            "ok": True,
            "action": "wake",
            "backend": "dev",
            "message": "Would wake (desktop simulation)",
        }
    if _vcgencmd_display_power(True):
        return {
            "ok": True,
            "action": "wake",
            "backend": "vcgencmd",
            "message": "Display on",
        }
    if _set_drm_dpms("On"):
        return {
            "ok": True,
            "action": "wake",
            "backend": "drm",
            "message": "Display on",
        }
    return {
        "ok": True,
        "action": "wake",
        "backend": "none",
        "message": "Wake requested",
    }


def apply_poweroff() -> dict[str, Any]:
    if DEV_MODE:
        return {
            "ok": True,
            "action": "poweroff",
            "backend": "dev",
            "message": "Would power off (desktop simulation)",
        }
    systemctl = shutil.which("systemctl")
    if not systemctl:
        raise ValueError("systemctl not available")

    def _halt() -> None:
        time.sleep(0.4)
        try:
            _run_cmd([systemctl, "poweroff"], timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            pass

    threading.Thread(target=_halt, daemon=True).start()
    return {
        "ok": True,
        "action": "poweroff",
        "backend": "systemctl",
        "message": "Powering off",
    }


def power_action(action: str) -> dict[str, Any]:
    name = action.strip().lower()
    if name == "activity":
        note_activity()
        return {"ok": True, "action": "activity"}
    if name == "sleep":
        return apply_display_sleep()
    if name == "wake":
        return apply_display_wake()
    if name in {"poweroff", "shutdown"}:
        return apply_poweroff()
    raise ValueError("action must be sleep, wake, poweroff, or activity")


def power_status() -> dict[str, Any]:
    settings = load_settings()
    power = settings.get("power") if isinstance(settings.get("power"), dict) else {}
    with POWER_LOCK:
        sleeping = bool(_POWER["sleeping"])
        last_activity = _POWER["last_activity"]
    return {
        "idleSec": int(power.get("idleSec") or 0),
        "sleeping": sleeping,
        "idleFor": int(max(0, time.monotonic() - last_activity)),
        "backend": "dev" if DEV_MODE else "system",
    }


def _open_input_devices() -> dict[int, str]:
    opened: dict[int, str] = {}
    root = Path("/dev/input")
    if not root.is_dir():
        return opened
    for path in sorted(root.glob("event*")):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        except OSError:
            continue
        opened[fd] = str(path)
    return opened


def _input_watch_loop() -> None:
    opened = _open_input_devices()
    last_scan = time.monotonic()
    try:
        while True:
            now = time.monotonic()
            if now - last_scan >= 10:
                for fd in list(opened):
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                opened = _open_input_devices()
                last_scan = now
            if not opened:
                time.sleep(1)
                continue
            try:
                ready, _, _ = select.select(list(opened), [], [], 1.0)
            except (OSError, ValueError):
                time.sleep(0.5)
                continue
            for fd in ready:
                try:
                    payload = os.read(fd, INPUT_EVENT_FORMAT.size * 8)
                except OSError:
                    continue
                size = INPUT_EVENT_FORMAT.size
                for offset in range(0, len(payload) - size + 1, size):
                    _sec, _usec, etype, _code, _value = INPUT_EVENT_FORMAT.unpack_from(
                        payload, offset
                    )
                    if etype in {EV_KEY, EV_REL, EV_ABS}:
                        note_activity()
                        break
    finally:
        for fd in opened:
            try:
                os.close(fd)
            except OSError:
                pass


def _idle_watch_loop() -> None:
    while True:
        time.sleep(1)
        settings = load_settings()
        power = settings.get("power") if isinstance(settings.get("power"), dict) else {}
        try:
            idle_sec = int(power.get("idleSec") or 0)
        except (TypeError, ValueError):
            idle_sec = 0
        if idle_sec <= 0:
            continue
        with POWER_LOCK:
            sleeping = bool(_POWER["sleeping"])
            last_activity = _POWER["last_activity"]
        if sleeping:
            continue
        if time.monotonic() - last_activity >= idle_sec:
            apply_display_sleep()


def start_power_watchers() -> None:
    threading.Thread(target=_idle_watch_loop, name="bh-idle", daemon=True).start()
    if DEV_MODE:
        return
    threading.Thread(target=_input_watch_loop, name="bh-input", daemon=True).start()


def load_apps() -> list[dict[str, Any]]:
    apps = load_json(apps_file(), [])
    return apps if isinstance(apps, list) else []


def save_apps(apps: list[dict[str, Any]]) -> None:
    save_json(apps_file(), apps)


def reorder_apps(ids: Any) -> list[dict[str, Any]]:
    if not isinstance(ids, list) or any(
        not isinstance(item, str) or not item.strip() for item in ids
    ):
        raise ValueError("ids must be a list of app ids")
    ordered_ids = [item.strip() for item in ids]
    apps = load_apps()
    current_ids = [str(app.get("id", "")) for app in apps]
    if sorted(ordered_ids) != sorted(current_ids):
        raise ValueError("ids must include each installed app exactly once")
    by_id = {str(app.get("id")): app for app in apps}
    ordered = [by_id[app_id] for app_id in ordered_ids]
    save_apps(ordered)
    return ordered


def catalog_hash(apps: list[dict[str, Any]]) -> str:
    canonical = json.dumps(apps, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def normalize_catalog_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        payload = payload.get("apps", [])
    if not isinstance(payload, list):
        raise ValueError("Catalog must be a JSON array or {\"apps\": [...]}")
    apps: list[dict[str, Any]] = []
    for item in payload:
        if isinstance(item, dict) and item.get("id") and item.get("name") and item.get("startUrl"):
            apps.append(item)
    return apps


def read_catalog_list(path: Path) -> list[dict[str, Any]]:
    raw = load_json(path, [])
    try:
        return normalize_catalog_payload(raw)
    except ValueError:
        return []


def ensure_catalog_cache() -> list[dict[str, Any]]:
    cache = catalog_cache_file()
    if cache.exists():
        cached = read_catalog_list(cache)
        if cached:
            return cached
    seeded = read_catalog_list(BUNDLED_CATALOG)
    if seeded:
        save_json(cache, seeded)
    return seeded


def fetch_catalog_payload(url: str, timeout: float = 8.0) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "blackholed/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise ValueError(f"Could not fetch catalog: {exc}") from exc
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Catalog response is not JSON") from exc
    return normalize_catalog_payload(payload)


def sync_catalog_from_remote(catalog_url: str | None = None) -> list[dict[str, Any]]:
    """Refresh data/catalog.json from catalogUrl when the remote list differs."""
    local = ensure_catalog_cache()
    settings = load_settings()
    url = (catalog_url or str(settings.get("catalogUrl") or DEFAULT_CATALOG_URL)).strip()
    if not url:
        return local
    try:
        remote = fetch_catalog_payload(url)
    except ValueError:
        return local
    if not remote:
        return local
    if catalog_hash(remote) != catalog_hash(local):
        save_json(catalog_cache_file(), remote)
        if url != settings.get("catalogUrl"):
            settings["catalogUrl"] = url
            save_settings(settings)
        return remote
    return local


def load_catalog(sync: bool = True) -> list[dict[str, Any]]:
    if sync:
        return sync_catalog_from_remote()
    return ensure_catalog_cache()


def local_shell_version() -> str | None:
    stamp = load_json(shell_version_file(), {})
    if isinstance(stamp, dict):
        version = stamp.get("version")
        if isinstance(version, str) and version:
            return version
    return None


def shell_status() -> dict[str, Any]:
    settings = load_settings()
    overlay = shell_overlay_dir()
    return {
        "shellUrl": str(settings.get("shellUrl") or DEFAULT_SHELL_UPDATE_URL).rstrip("/"),
        "shellVersion": local_shell_version(),
        "shellOverlay": str(overlay),
        "shellReady": (overlay / "index.html").is_file(),
        "shellSynced": local_shell_version() is not None,
    }


def ensure_shell_overlay() -> bool:
    """Seed data/shell from the image bundle. Never touches apps.json."""
    overlay = shell_overlay_dir()
    index = overlay / "index.html"
    if index.is_file():
        return True
    if not BUNDLED_SHELL.is_dir():
        return False
    overlay.parent.mkdir(parents=True, exist_ok=True)
    if overlay.exists():
        shutil.rmtree(overlay)
    shutil.copytree(BUNDLED_SHELL, overlay)
    return index.is_file()


def _safe_shell_relpath(raw: str) -> str:
    path = raw.strip()
    if not path.startswith("/") or path.startswith("//") or ".." in path.split("/"):
        raise ValueError(f"Unsafe shell path: {raw}")
    return path.lstrip("/")


def download_bytes(url: str, timeout: float = 60.0) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "blackholed/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.URLError as exc:
        raise ValueError(f"Download failed ({url}): {exc}") from exc


def sync_shell_from_remote(shell_url: str | None = None) -> dict[str, Any]:
    """
    Pull shell UI from the hosted panel into data/shell when the manifest version
    changes. Installed PWAs (apps.json) are never modified.
    """
    ensure_shell_overlay()
    settings = load_settings()
    origin = (
        shell_url or str(settings.get("shellUrl") or DEFAULT_SHELL_UPDATE_URL)
    ).strip().rstrip("/")
    if not origin:
        return {
            "ok": False,
            "updated": False,
            "message": "No shellUrl configured",
            **shell_status(),
        }

    manifest_url = f"{origin}/shell-manifest.json"
    try:
        manifest = fetch_json(manifest_url, timeout=12.0)
    except ValueError as exc:
        return {
            "ok": False,
            "updated": False,
            "message": str(exc),
            **shell_status(),
        }

    version = str(manifest.get("version") or "").strip()
    files = manifest.get("files")
    if not version or not isinstance(files, list) or not files:
        return {
            "ok": False,
            "updated": False,
            "message": "Invalid shell-manifest.json",
            **shell_status(),
        }

    current = local_shell_version()
    if current == version and (shell_overlay_dir() / "index.html").is_file():
        if origin != settings.get("shellUrl"):
            settings["shellUrl"] = origin
            save_settings(settings)
        return {
            "ok": True,
            "updated": False,
            "message": f"Shell up to date ({version[:12]}…)",
            **shell_status(),
        }

    staging = data_dir() / "shell.staging"
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        for item in files:
            if not isinstance(item, dict):
                raise ValueError("Manifest file entry must be an object")
            rel = _safe_shell_relpath(str(item.get("path") or ""))
            expected = str(item.get("sha256") or "").strip().lower()
            if not expected:
                raise ValueError(f"Missing sha256 for {rel}")
            url = urllib.parse.urljoin(origin + "/", rel)
            payload = download_bytes(url)
            digest = hashlib.sha256(payload).hexdigest()
            if digest != expected:
                raise ValueError(f"sha256 mismatch for /{rel}")
            dest = staging / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(payload)

        if not (staging / "index.html").is_file():
            raise ValueError("Downloaded shell is missing index.html")

        overlay = shell_overlay_dir()
        backup = data_dir() / "shell.prev"
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
        if overlay.exists():
            overlay.rename(backup)
        try:
            staging.rename(overlay)
        except OSError:
            if backup.exists() and not overlay.exists():
                backup.rename(overlay)
            raise
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)

        save_json(
            shell_version_file(),
            {
                "version": version,
                "shellUrl": origin,
                "syncedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )
        settings["shellUrl"] = origin
        save_settings(settings)
        return {
            "ok": True,
            "updated": True,
            "message": f"Shell updated to {version[:12]}…",
            **shell_status(),
        }
    except Exception as exc:  # noqa: BLE001
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        return {
            "ok": False,
            "updated": False,
            "message": f"Shell sync failed: {exc}",
            **shell_status(),
        }


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "app"


def absolute_url(base: str, maybe_relative: str | None) -> str | None:
    if not maybe_relative:
        return None
    return urllib.parse.urljoin(base, maybe_relative)


def pick_icon(icons: list[Any], base: str) -> str | None:
    best: tuple[int, str] | None = None
    for icon in icons:
        if not isinstance(icon, dict):
            continue
        src = icon.get("src")
        if not src:
            continue
        sizes = str(icon.get("sizes", "0x0")).split()[0]
        try:
            width = int(sizes.split("x")[0])
        except ValueError:
            width = 0
        url = absolute_url(base, src)
        if url and (best is None or width >= best[0]):
            best = (width, url)
    return best[1] if best else None


def fetch_manifest(manifest_url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        manifest_url,
        headers={"Accept": "application/manifest+json,application/json,*/*"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise ValueError(f"Manifest fetch failed: {exc}") from exc

    try:
        manifest = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Manifest is not JSON") from exc

    if not isinstance(manifest, dict):
        raise ValueError("Manifest root must be an object")

    name = (
        manifest.get("name")
        or manifest.get("short_name")
        or urllib.parse.urlparse(manifest_url).hostname
        or "App"
    )
    start = absolute_url(manifest_url, manifest.get("start_url") or "/")
    icon = pick_icon(manifest.get("icons") or [], manifest_url)

    return {
        "id": slugify(str(name)),
        "name": str(name),
        "description": str(manifest.get("description") or ""),
        "manifestUrl": manifest_url,
        "startUrl": start or manifest_url,
        "icon": icon,
        "display": str(manifest.get("display") or "standalone"),
        "source": "sideload",
    }


def install_from_catalog(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry["id"],
        "name": entry["name"],
        "description": entry.get("description", ""),
        "manifestUrl": entry.get("manifestUrl", ""),
        "startUrl": entry["startUrl"],
        "icon": entry.get("icon"),
        "display": "standalone",
        "source": "catalog",
        "category": entry.get("category"),
    }


def write_launch(url: str) -> None:
    save_json(launch_file(), {"url": url, "shell": SHELL_URL})


def run_rauc(*args: str) -> tuple[int, str]:
    binary = shutil.which("rauc")
    if not binary:
        return 127, "rauc not installed"
    try:
        completed = subprocess.run(
            [binary, *args],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except OSError as exc:
        return 1, str(exc)
    out = (completed.stdout or "") + (completed.stderr or "")
    return completed.returncode, out.strip()


def version_tuple(value: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in re.split(r"[^0-9]+", value):
        if chunk.isdigit():
            parts.append(int(chunk))
    return tuple(parts) or (0,)


def is_newer(remote: str, local: str) -> bool:
    return version_tuple(remote) > version_tuple(local)


def fetch_json(url: str, timeout: float = 20.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "blackholed/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise ValueError(f"HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Could not fetch {url}: {exc}") from exc
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Channel response is not JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("Channel root must be an object")
    return payload


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def download_bundle(url: str) -> Path:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("bundleUrl must be http(s)")
    suffix = Path(parsed.path).suffix or ".raucb"
    dest = Path(tempfile.mkdtemp(prefix="blackhole-ota-")) / f"bundle{suffix}"
    request = urllib.request.Request(url, headers={"User-Agent": "blackholed/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as out:
            shutil.copyfileobj(response, out)
    except urllib.error.URLError as exc:
        raise ValueError(f"Download failed: {exc}") from exc
    return dest


def _nmcli_fields(line: str) -> list[str]:
    """Split nmcli terse output, unescaping backslash-escaped colons."""
    parts: list[str] = []
    current: list[str] = []
    escaped = False
    for char in line:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def _run_cmd(args: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def mock_wifi_networks(settings: dict[str, Any]) -> list[dict[str, Any]]:
    saved = str(settings.get("network", {}).get("ssid") or "")
    networks: list[dict[str, Any]] = [
        {"ssid": "TestNet", "signal": "80", "security": "WPA2", "bssid": "aa:bb:cc:dd:ee:01"},
        {"ssid": "CoffeeShop", "signal": "65", "security": "WPA2", "bssid": "aa:bb:cc:dd:ee:02"},
        {"ssid": "OpenLab", "signal": "42", "security": "", "bssid": "aa:bb:cc:dd:ee:03"},
    ]
    if saved and saved not in {item["ssid"] for item in networks}:
        networks.insert(
            0,
            {
                "ssid": saved,
                "signal": "80",
                "security": "WPA2",
                "bssid": "aa:bb:cc:dd:ee:00",
            },
        )
    for item in networks:
        item["inUse"] = bool(saved) and item["ssid"] == saved
    networks.sort(key=lambda item: (not item["inUse"], -int(item["signal"])))
    return networks


def parse_wifi_list(stdout: str) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for line in stdout.splitlines():
        parts = _nmcli_fields(line)
        if len(parts) < 5:
            continue
        in_use, ssid, signal, security, bssid = parts[0], parts[1], parts[2], parts[3], parts[4]
        ssid = ssid.strip()
        if not ssid:
            continue
        try:
            strength = int(str(signal).strip() or "0")
        except ValueError:
            strength = 0
        row = {
            "ssid": ssid,
            "signal": str(strength),
            "security": security.strip(),
            "inUse": in_use.strip() == "*",
            "bssid": bssid.strip(),
        }
        previous = best.get(ssid)
        if previous is None or row["inUse"] or int(row["signal"]) > int(previous["signal"]):
            if previous and previous["inUse"]:
                row["inUse"] = True
            best[ssid] = row
    networks = list(best.values())
    networks.sort(key=lambda item: (not item["inUse"], -int(item["signal"] or 0)))
    return networks


def network_status(settings: dict[str, Any]) -> dict[str, Any]:
    ssid = str(settings.get("network", {}).get("ssid") or "")
    nmcli = shutil.which("nmcli")
    if nmcli:
        try:
            completed = _run_cmd(
                [nmcli, "-t", "-f", "ACTIVE,SSID,SIGNAL,DEVICE", "dev", "wifi"],
                timeout=8,
            )
            active = None
            for line in (completed.stdout or "").splitlines():
                parts = _nmcli_fields(line)
                if len(parts) >= 4 and parts[0] == "yes":
                    active = {
                        "connected": True,
                        "ssid": parts[1],
                        "signal": parts[2],
                        "device": parts[3],
                        "backend": "nmcli",
                    }
                    break
            if active:
                return active
            return {
                "connected": False,
                "ssid": ssid or None,
                "backend": "nmcli",
                "message": "Not connected",
            }
        except (OSError, subprocess.TimeoutExpired):
            pass

    if DEV_MODE:
        if ssid:
            signal = "80"
            for item in mock_wifi_networks({"network": {"ssid": ssid}}):
                if item["ssid"] == ssid:
                    signal = str(item["signal"])
                    break
            return {
                "connected": True,
                "ssid": ssid,
                "signal": signal,
                "backend": "dev",
                "message": "Simulated connection (desktop)",
            }
        return {
            "connected": False,
            "ssid": None,
            "backend": "dev",
            "message": "No network saved yet",
        }

    return {
        "connected": False,
        "ssid": ssid or None,
        "backend": "none",
        "message": "NetworkManager not available",
    }


def scan_wifi(settings: dict[str, Any]) -> dict[str, Any]:
    nmcli = shutil.which("nmcli")
    if nmcli:
        try:
            _run_cmd([nmcli, "device", "wifi", "rescan"], timeout=12)
        except (OSError, subprocess.TimeoutExpired):
            pass
        try:
            time.sleep(1.5)
            completed = _run_cmd(
                [nmcli, "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY,BSSID", "device", "wifi", "list"],
                timeout=12,
            )
            networks = parse_wifi_list(completed.stdout or "")
            return {
                "networks": networks,
                "backend": "nmcli",
                "network": network_status(settings),
            }
        except (OSError, subprocess.TimeoutExpired):
            pass

    if DEV_MODE:
        return {
            "networks": mock_wifi_networks(settings),
            "backend": "dev",
            "network": network_status(settings),
        }

    return {
        "networks": [],
        "backend": "none",
        "network": network_status(settings),
        "message": "NetworkManager not available",
    }


def apply_wifi(ssid: str, password: str) -> dict[str, Any]:
    nmcli = shutil.which("nmcli")
    if nmcli and ssid:
        try:
            args = [nmcli, "dev", "wifi", "connect", ssid]
            if password:
                args.extend(["password", password])
            completed = _run_cmd(args, timeout=45)
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "nmcli failed").strip()
                raise ValueError(detail)
            kick_timesyncd()
            threading.Thread(target=apply_auto_timezone, daemon=True).start()
            return {"ok": True, "message": f"Connected to {ssid}", "backend": "nmcli"}
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError(str(exc)) from exc

    if DEV_MODE:
        kick_timesyncd()
        threading.Thread(target=apply_auto_timezone, daemon=True).start()
        return {
            "ok": True,
            "message": f"Saved {ssid or 'network'} (desktop simulation)",
            "backend": "dev",
        }

    raise ValueError("Wi-Fi connect requires NetworkManager (nmcli) on device")


BT_LOCK = threading.Lock()
_DEV_BT: dict[str, Any] = {
    "powered": True,
    "discovering": False,
    "devices": [
        {
            "address": "00:11:22:33:44:55",
            "name": "TV Remote",
            "paired": True,
            "connected": True,
            "trusted": True,
        },
        {
            "address": "AA:BB:CC:11:22:33",
            "name": "Soundbar",
            "paired": False,
            "connected": False,
            "trusted": False,
        },
    ],
}


def run_bluetoothctl(*args: str, timeout: float = 20) -> tuple[int, str]:
    binary = shutil.which("bluetoothctl")
    if not binary:
        return 127, "bluetoothctl not installed"
    try:
        completed = _run_cmd([binary, *args], timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)
    out = ((completed.stdout or "") + (completed.stderr or "")).strip()
    return completed.returncode, out


def _parse_bt_devices(args: list[str]) -> dict[str, str]:
    code, output = run_bluetoothctl(*args, timeout=8)
    if code == 127:
        return {}
    found: dict[str, str] = {}
    for line in output.splitlines():
        match = re.match(r"Device\s+([0-9A-Fa-f:]{17})\s+(.*)$", line.strip())
        if not match:
            continue
        address = match.group(1).upper()
        name = match.group(2).strip() or address
        found[address] = name
    return found


def _bt_show_flags(output: str) -> tuple[bool, bool]:
    powered = False
    discovering = False
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("Powered:"):
            powered = stripped.split(":", 1)[1].strip().lower() == "yes"
        elif stripped.startswith("Discovering:"):
            discovering = stripped.split(":", 1)[1].strip().lower() == "yes"
    return powered, discovering


def mock_bluetooth_status() -> dict[str, Any]:
    with BT_LOCK:
        return {
            "powered": bool(_DEV_BT["powered"]),
            "discovering": bool(_DEV_BT["discovering"]),
            "backend": "dev",
            "devices": [dict(item) for item in _DEV_BT["devices"]],
        }


def mock_bluetooth_action(
    action: str,
    address: str = "",
    powered: bool | None = None,
) -> dict[str, Any]:
    addr = address.strip().upper()
    with BT_LOCK:
        devices: list[dict[str, Any]] = _DEV_BT["devices"]

        def find() -> dict[str, Any]:
            for item in devices:
                if str(item["address"]).upper() == addr:
                    return item
            raise ValueError(f"Unknown device: {address}")

        if action == "power":
            _DEV_BT["powered"] = (not bool(_DEV_BT["powered"])) if powered is None else bool(powered)
            if not _DEV_BT["powered"]:
                _DEV_BT["discovering"] = False
                for item in devices:
                    item["connected"] = False
            return {
                "ok": True,
                "message": "Bluetooth on" if _DEV_BT["powered"] else "Bluetooth off",
            }
        if action == "scan":
            if not _DEV_BT["powered"]:
                raise ValueError("Turn Bluetooth on first")
            if not any(not item["paired"] for item in devices):
                devices.append(
                    {
                        "address": "DE:AD:BE:EF:00:01",
                        "name": "Keyboard",
                        "paired": False,
                        "connected": False,
                        "trusted": False,
                    }
                )
            return {"ok": True, "message": "Scan complete"}
        if not addr:
            raise ValueError("address is required")
        if action == "pair":
            if not _DEV_BT["powered"]:
                raise ValueError("Turn Bluetooth on first")
            item = find()
            item["paired"] = True
            item["trusted"] = True
            item["connected"] = True
            for other in devices:
                if other is not item:
                    other["connected"] = False
            return {"ok": True, "message": f"Paired with {item['name']}"}
        if action == "connect":
            if not _DEV_BT["powered"]:
                raise ValueError("Turn Bluetooth on first")
            item = find()
            if not item["paired"]:
                item["paired"] = True
                item["trusted"] = True
            item["connected"] = True
            return {"ok": True, "message": f"Connected to {item['name']}"}
        if action == "disconnect":
            item = find()
            item["connected"] = False
            return {"ok": True, "message": f"Disconnected {item['name']}"}
        if action == "remove":
            item = find()
            name = item["name"]
            _DEV_BT["devices"] = [entry for entry in devices if entry is not item]
            return {"ok": True, "message": f"Forgot {name}"}
        raise ValueError(f"Unknown Bluetooth action: {action}")


def bluetooth_devices_real() -> list[dict[str, Any]]:
    known = _parse_bt_devices(["devices"])
    paired = _parse_bt_devices(["devices", "Paired"]) or _parse_bt_devices(["paired-devices"])
    connected = _parse_bt_devices(["devices", "Connected"])
    trusted = _parse_bt_devices(["devices", "Trusted"])
    addresses = dict(known)
    addresses.update(paired)
    addresses.update(connected)
    addresses.update(trusted)
    devices: list[dict[str, Any]] = []
    for addr, name in addresses.items():
        is_paired = addr in paired
        devices.append(
            {
                "address": addr,
                "name": name,
                "paired": is_paired,
                "connected": addr in connected,
                "trusted": addr in trusted or is_paired,
            }
        )
    devices.sort(
        key=lambda item: (not item["connected"], not item["paired"], str(item["name"]).lower())
    )
    return devices


def bluetooth_status() -> dict[str, Any]:
    code, output = run_bluetoothctl("show", timeout=8)
    if code != 127 and "No default controller" not in output and "not available" not in output.lower():
        powered, discovering = _bt_show_flags(output)
        if "Powered:" in output or powered or discovering or bluetooth_devices_real():
            return {
                "powered": powered,
                "discovering": discovering,
                "backend": "bluez",
                "devices": bluetooth_devices_real(),
            }

    if DEV_MODE:
        return mock_bluetooth_status()

    return {
        "powered": False,
        "discovering": False,
        "backend": "none",
        "devices": [],
        "message": "Bluetooth adapter not available",
    }


def pair_bluetooth_with_pin(addr: str, pin: str) -> tuple[int, str]:
    """Drive bluetoothctl with a KeyboardDisplay agent and feed a PIN/passkey."""
    binary = shutil.which("bluetoothctl")
    if not binary:
        return 127, "bluetoothctl not installed"
    pin = pin.strip()
    try:
        proc = subprocess.Popen(  # noqa: S603
            [binary],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
    except OSError as exc:
        return 1, str(exc)

    assert proc.stdin is not None
    assert proc.stdout is not None
    commands = [
        "agent KeyboardDisplay\n",
        "default-agent\n",
        f"pair {addr}\n",
    ]
    for command in commands:
        try:
            proc.stdin.write(command)
            proc.stdin.flush()
        except OSError as exc:
            proc.kill()
            return 1, str(exc)

    output_chunks: list[str] = []
    deadline = time.time() + 40
    pin_sent = False
    try:
        while time.time() < deadline:
            if proc.poll() is not None and not pin_sent:
                break
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.05)
                continue
            output_chunks.append(line)
            lowered = line.lower()
            if not pin_sent and (
                "passkey" in lowered
                or "pin code" in lowered
                or "enter pin" in lowered
                or "request" in lowered and "pin" in lowered
            ):
                try:
                    proc.stdin.write(f"{pin}\n")
                    proc.stdin.flush()
                    pin_sent = True
                except OSError as exc:
                    proc.kill()
                    return 1, str(exc)
            if "pairing successful" in lowered or "already exists" in lowered:
                break
            if "failed" in lowered and "pair" in lowered:
                break
        try:
            proc.stdin.write("quit\n")
            proc.stdin.flush()
        except OSError:
            pass
        try:
            remaining, _ = proc.communicate(timeout=5)
            if remaining:
                output_chunks.append(remaining)
        except subprocess.TimeoutExpired:
            proc.kill()
            remaining, _ = proc.communicate(timeout=2)
            if remaining:
                output_chunks.append(remaining)
    except Exception as exc:  # noqa: BLE001
        proc.kill()
        return 1, str(exc)
    text = "".join(output_chunks).strip()
    ok = (
        "pairing successful" in text.lower()
        or "already exists" in text.lower()
        or (pin_sent and "failed" not in text.lower())
    )
    return (0 if ok else 1), text


def bluetooth_action(
    action: str,
    address: str = "",
    powered: bool | None = None,
    pin: str | None = None,
) -> dict[str, Any]:
    action = action.strip().lower()
    if action not in {"power", "scan", "pair", "connect", "disconnect", "remove"}:
        raise ValueError(f"Unknown Bluetooth action: {action}")

    status = bluetooth_status()
    if status.get("backend") == "dev":
        result = mock_bluetooth_action(action, address, powered)
        return {**result, "bluetooth": mock_bluetooth_status()}

    if status.get("backend") != "bluez":
        if DEV_MODE:
            result = mock_bluetooth_action(action, address, powered)
            return {**result, "bluetooth": mock_bluetooth_status()}
        raise ValueError("Bluetooth requires BlueZ (bluetoothctl) on device")

    addr = address.strip()
    if action == "power":
        want_on = (not bool(status.get("powered"))) if powered is None else bool(powered)
        code, output = run_bluetoothctl("power", "on" if want_on else "off", timeout=12)
        if code not in (0, 127) and "succeeded" not in output.lower() and "Changing power" not in output:
            if code != 0:
                raise ValueError(output or "Could not change Bluetooth power")
        return {
            "ok": True,
            "message": "Bluetooth on" if want_on else "Bluetooth off",
            "bluetooth": bluetooth_status(),
        }

    if action == "scan":
        if not status.get("powered"):
            raise ValueError("Turn Bluetooth on first")
        _code, _output = run_bluetoothctl("--timeout", "8", "scan", "on", timeout=14)
        return {"ok": True, "message": "Scan complete", "bluetooth": bluetooth_status()}

    if not addr:
        raise ValueError("address is required")

    if action == "pair":
        if not status.get("powered"):
            raise ValueError("Turn Bluetooth on first")
        pin_value = (pin or "").strip()
        if pin_value:
            pair_code, pair_out = pair_bluetooth_with_pin(addr, pin_value)
        else:
            pair_code, pair_out = run_bluetoothctl("pair", addr, timeout=40)
        run_bluetoothctl("trust", addr, timeout=12)
        conn_code, conn_out = run_bluetoothctl("connect", addr, timeout=20)
        if pair_code != 0 and "already" not in pair_out.lower() and conn_code != 0:
            raise ValueError(pair_out or conn_out or "Pairing failed")
        return {"ok": True, "message": f"Paired with {addr}", "bluetooth": bluetooth_status()}

    if action == "connect":
        if not status.get("powered"):
            raise ValueError("Turn Bluetooth on first")
        code, output = run_bluetoothctl("connect", addr, timeout=20)
        if code != 0 and "successful" not in output.lower():
            raise ValueError(output or "Connect failed")
        return {"ok": True, "message": f"Connected to {addr}", "bluetooth": bluetooth_status()}

    if action == "disconnect":
        code, output = run_bluetoothctl("disconnect", addr, timeout=16)
        if code != 0 and "successful" not in output.lower():
            raise ValueError(output or "Disconnect failed")
        return {"ok": True, "message": f"Disconnected {addr}", "bluetooth": bluetooth_status()}

    code, output = run_bluetoothctl("remove", addr, timeout=16)
    if code != 0:
        raise ValueError(output or "Could not forget device")
    return {"ok": True, "message": f"Forgot {addr}", "bluetooth": bluetooth_status()}


def update_status_payload() -> dict[str, Any]:
    code, output = run_rauc("status")
    settings = load_settings()
    base = {
        "compatible": "blackhole-os",
        "version": VERSION,
        "channelUrl": settings.get("channelUrl") or DEFAULT_CHANNEL,
        "remote": None,
        "updateAvailable": False,
    }
    if code == 127:
        return {
            **base,
            "available": False,
            "dev": DEV_MODE,
            "slot": "A" if DEV_MODE else "unknown",
            "message": "RAUC not present (desktop/dev mode)",
            "raw": output,
        }

    slot = "unknown"
    for line in output.splitlines():
        if "booted:" in line.lower() or "bootname" in line.lower():
            slot = line.split(":")[-1].strip()
            break
    return {
        **base,
        "available": True,
        "dev": False,
        "slot": slot,
        "message": "RAUC ready",
        "raw": output,
    }


def check_channel(channel_url: str | None = None) -> dict[str, Any]:
    settings = load_settings()
    url = (channel_url or settings.get("channelUrl") or DEFAULT_CHANNEL).strip()
    if not url:
        raise ValueError("No channel URL configured")
    status = update_status_payload()
    status["channelUrl"] = url
    try:
        channel = fetch_json(url)
    except ValueError as exc:
        detail = str(exc)
        if "404" in detail or "Not Found" in detail:
            status["message"] = "No system update published yet"
        else:
            status["message"] = "Could not reach updates"
        return status
    remote_version = str(channel.get("version") or "")
    compatible = str(channel.get("compatible") or "")
    bundle_url = str(channel.get("bundleUrl") or "")
    if compatible and compatible != "blackhole-os":
        raise ValueError(f"Incompatible channel: {compatible}")
    if not remote_version or not bundle_url:
        raise ValueError("channel.json needs version and bundleUrl")

    newer = is_newer(remote_version, VERSION)
    status["remote"] = {
        "version": remote_version,
        "bundleUrl": bundle_url,
        "sha256": channel.get("sha256"),
        "notes": channel.get("notes") or "",
        "newer": newer,
    }
    status["updateAvailable"] = newer
    status["message"] = (
        f"Update {remote_version} available"
        if newer
        else f"Up to date ({VERSION})"
    )
    # Persist last-used channel
    settings["channelUrl"] = url
    save_settings(settings)
    return status


def install_bundle_path(bundle: Path, expected_sha: str | None = None) -> dict[str, Any]:
    if not bundle.exists():
        raise FileNotFoundError(f"Bundle not found: {bundle}")
    if expected_sha:
        digest = sha256_file(bundle)
        if digest.lower() != expected_sha.lower():
            raise ValueError("Bundle sha256 mismatch")

    code, output = run_rauc("install", str(bundle))
    if code == 127:
        if DEV_MODE:
            return {
                "ok": True,
                "dev": True,
                "message": (
                    f"Simulated install of {bundle.name}. "
                    "Reboot would switch slots."
                ),
                "raw": output,
                "path": str(bundle),
            }
        raise RuntimeError("RAUC not installed")
    if code != 0:
        raise RuntimeError(output or "rauc install failed")
    return {
        "ok": True,
        "dev": False,
        "message": "Bundle installed. Reboot to activate.",
        "raw": output,
        "path": str(bundle),
    }


def build_record(url: str) -> dict[str, Any]:
    catalog = {item["id"]: item for item in load_catalog()}
    catalog_by_manifest = {
        item.get("manifestUrl"): item for item in load_catalog() if item.get("manifestUrl")
    }
    by_start = {item["startUrl"]: item for item in load_catalog()}

    if url in catalog:
        return install_from_catalog(catalog[url])
    if url in catalog_by_manifest:
        return install_from_catalog(catalog_by_manifest[url])
    if url.startswith("catalog:"):
        catalog_id = url.removeprefix("catalog:")
        if catalog_id not in catalog:
            raise ValueError(f"Unknown catalog app: {catalog_id}")
        return install_from_catalog(catalog[catalog_id])

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Provide a catalog id or http(s) URL")

    if url in by_start:
        return install_from_catalog(by_start[url])
    if url.endswith("manifest.json") or url.endswith(".webmanifest") or "manifest" in url:
        return fetch_manifest(url)

    host = parsed.hostname or "app"
    return {
        "id": slugify(host),
        "name": host,
        "description": "Sideloaded from URL",
        "manifestUrl": "",
        "startUrl": url,
        "icon": None,
        "display": "standalone",
        "source": "sideload",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "blackholed/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[blackholed] {self.address_string()} - {fmt % args}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body") from exc
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        try:
            if path == "/health":
                return self._send(200, {"status": "ok"})
            if path == "/catalog":
                return self._send(200, {"apps": load_catalog()})
            if path == "/apps":
                return self._send(200, {"apps": load_apps()})
            if path == "/settings":
                return self._send(200, {"settings": load_settings()})
            if path == "/time":
                return self._send(200, time_status(include_zones=True))
            if path == "/power":
                return self._send(200, power_status())
            if path == "/network/scan":
                settings = load_settings()
                payload = scan_wifi(settings)
                payload["settings"] = settings["network"]
                return self._send(200, payload)
            if path == "/network":
                settings = load_settings()
                return self._send(200, {"network": network_status(settings), "settings": settings["network"]})
            if path == "/bluetooth":
                return self._send(200, {"bluetooth": bluetooth_status()})
            if path == "/system":
                settings = load_settings()
                status = shell_status()
                return self._send(
                    200,
                    {
                        "name": "Blackhole OS",
                        "version": VERSION,
                        "machine": MACHINE,
                        "shellUrl": SHELL_URL,
                        "ublock": {
                            "enabled": True,
                            "extension": "uBlock Origin Lite",
                            "note": "Loaded via --load-extension (Manifest V3)",
                            "filtering": (settings.get("adblock") or {}).get(
                                "filtering", "optimal"
                            ),
                        },
                        "dev": DEV_MODE,
                        "dataDir": str(data_dir()),
                        "channelUrl": settings.get("channelUrl"),
                        "catalogUrl": settings.get("catalogUrl"),
                        "panelUrl": status.get("shellUrl"),
                        "shellVersion": status.get("shellVersion"),
                        "shellSynced": status.get("shellSynced"),
                        "shellReady": status.get("shellReady"),
                        "display": settings.get("display"),
                        "adblock": settings.get("adblock"),
                        "time": time_status(),
                        "power": power_status(),
                    },
                )
            if path == "/update":
                return self._send(200, update_status_payload())
            if path == "/launch":
                payload = load_json(launch_file(), None)
                if not isinstance(payload, dict):
                    return self._send(200, {"url": None, "pending": False})
                return self._send(
                    200,
                    {
                        "url": payload.get("url"),
                        "shell": payload.get("shell", SHELL_URL),
                        "pending": True,
                    },
                )
            return self._send(404, {"detail": f"Not found: {path}"})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"detail": str(exc)})

    def do_PUT(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        try:
            if path == "/settings":
                body = self._read_json()
                patch = body.get("settings") if isinstance(body.get("settings"), dict) else body
                if not isinstance(patch, dict):
                    return self._send(400, {"detail": "settings object required"})
                saved = persist_settings(patch)
                return self._send(200, {"settings": saved})
            return self._send(404, {"detail": f"Not found: {path}"})
        except ValueError as exc:
            return self._send(400, {"detail": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"detail": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        try:
            if path == "/apps/order":
                body = self._read_json()
                apps = reorder_apps(body.get("ids"))
                return self._send(200, {"apps": apps})

            if path == "/shell/sync":
                body = {}
                if int(self.headers.get("Content-Length", "0") or "0"):
                    body = self._read_json()
                shell_url = str(body.get("shellUrl") or "").strip() or None
                result = sync_shell_from_remote(shell_url)
                code = 200 if result.get("ok") else 502
                return self._send(code, result)

            if path == "/apps":
                body = self._read_json()
                url = str(body.get("manifestUrl", "")).strip()
                if not url:
                    return self._send(400, {"detail": "manifestUrl is required"})
                record = build_record(url)
                apps = [a for a in load_apps() if a.get("id") != record["id"]]
                apps.append(record)
                save_apps(apps)
                return self._send(200, {"app": record, "apps": apps})

            if path == "/settings":
                body = self._read_json()
                patch = body.get("settings") if isinstance(body.get("settings"), dict) else body
                if not isinstance(patch, dict):
                    return self._send(400, {"detail": "settings object required"})
                saved = persist_settings(patch)
                return self._send(200, {"settings": saved})

            if path == "/time":
                body = self._read_json() if int(self.headers.get("Content-Length", "0") or "0") else {}
                patch_time: dict[str, Any] = {}
                if "timezone" in body:
                    patch_time["timezone"] = str(body.get("timezone") or "UTC")
                    if "autoTimezone" not in body:
                        patch_time["autoTimezone"] = False
                if "ntp" in body:
                    patch_time["ntp"] = bool(body.get("ntp"))
                if "autoTimezone" in body:
                    patch_time["autoTimezone"] = bool(body.get("autoTimezone"))
                if "hour12" in body:
                    patch_time["hour12"] = bool(body.get("hour12"))
                iso = str(body.get("iso") or "").strip()
                if iso:
                    patch_time["ntp"] = False
                if not patch_time:
                    return self._send(400, {"detail": "timezone, ntp, autoTimezone, hour12, or iso required"})
                saved = persist_settings({"time": patch_time})
                if iso:
                    apply_time_settings(saved, set_clock=parse_clock_string(iso))
                return self._send(200, {"ok": True, "time": time_status(include_zones=True), "settings": saved})

            if path == "/power":
                body = self._read_json() if int(self.headers.get("Content-Length", "0") or "0") else {}
                action = str(body.get("action") or "").strip()
                if not action:
                    return self._send(400, {"detail": "action is required"})
                result = power_action(action)
                result["power"] = power_status()
                return self._send(200, result)

            if path == "/network":
                body = self._read_json()
                ssid = str(body.get("ssid", "")).strip()
                password = str(body.get("password", ""))
                if not ssid:
                    return self._send(400, {"detail": "ssid is required"})
                settings = persist_settings(
                    {
                        "network": {
                            "ssid": ssid,
                            "password": password,
                            "mode": str(body.get("mode") or "dhcp"),
                        }
                    }
                )
                result = apply_wifi(ssid, password)
                return self._send(
                    200,
                    {
                        **result,
                        "network": network_status(settings),
                        "settings": settings["network"],
                    },
                )

            if path == "/bluetooth":
                body = self._read_json() if int(self.headers.get("Content-Length", "0") or "0") else {}
                action = str(body.get("action") or "").strip()
                if not action:
                    return self._send(400, {"detail": "action is required"})
                powered = body.get("powered")
                if powered is not None:
                    powered = bool(powered)
                pin = body.get("pin")
                result = bluetooth_action(
                    action,
                    str(body.get("address") or ""),
                    powered if isinstance(powered, bool) else None,
                    str(pin) if pin is not None else None,
                )
                return self._send(200, result)

            if path == "/launch/ack":
                launch = launch_file()
                if launch.exists():
                    launch.unlink()
                return self._send(200, {"ok": True})

            if path == "/update/check":
                body = self._read_json() if int(self.headers.get("Content-Length", "0") or "0") else {}
                channel_url = str(body.get("channelUrl") or "").strip() or None
                return self._send(200, check_channel(channel_url))

            if path == "/update":
                body = self._read_json()
                expected_sha = str(body.get("sha256") or "").strip() or None
                bundle_url = str(body.get("bundleUrl") or "").strip()
                bundle_path = str(body.get("bundlePath") or "").strip()

                # Install latest from channel when requested.
                if body.get("fromChannel"):
                    status = check_channel(str(body.get("channelUrl") or "").strip() or None)
                    remote = status.get("remote") or {}
                    bundle_url = str(remote.get("bundleUrl") or "")
                    expected_sha = str(remote.get("sha256") or "") or expected_sha
                    if not bundle_url:
                        return self._send(400, {"detail": "Channel has no bundleUrl"})

                downloaded: Path | None = None
                try:
                    if bundle_url:
                        downloaded = download_bundle(bundle_url)
                        result = install_bundle_path(downloaded, expected_sha)
                    elif bundle_path:
                        result = install_bundle_path(Path(bundle_path).expanduser(), expected_sha)
                    else:
                        return self._send(
                            400,
                            {"detail": "Provide bundleUrl, bundlePath, or fromChannel"},
                        )
                except FileNotFoundError as exc:
                    return self._send(404, {"detail": str(exc)})
                except ValueError as exc:
                    return self._send(400, {"detail": str(exc)})
                except RuntimeError as exc:
                    return self._send(500, {"detail": str(exc)})
                finally:
                    if downloaded and downloaded.exists():
                        # Keep file briefly for debugging in DEV; always unlink parent tmp.
                        try:
                            shutil.rmtree(downloaded.parent, ignore_errors=True)
                        except OSError:
                            pass

                return self._send(200, result)

            launch_match = re.fullmatch(r"/apps/([^/]+)/launch", path)
            if launch_match:
                app_id = urllib.parse.unquote(launch_match.group(1))
                if app_id == "shell":
                    write_launch(SHELL_URL)
                    return self._send(200, {"url": SHELL_URL, "via": "launch-file"})
                apps = {a["id"]: a for a in load_apps()}
                if app_id not in apps:
                    return self._send(404, {"detail": f"App not installed: {app_id}"})
                url = apps[app_id]["startUrl"]
                write_launch(url)
                # Optional: open an external browser window (desktop only).
                # Default is off — the shell / kiosk-bridge navigates the same tab.
                if DEV_MODE and os.environ.get("BLACKHOLE_LAUNCH_EXTERNAL", "0") == "1":
                    for browser in (
                        "chromium",
                        "chromium-browser",
                        "google-chrome",
                        "google-chrome-stable",
                    ):
                        if shutil.which(browser):
                            subprocess.Popen(  # noqa: S603
                                [browser, "--new-window", url],
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                            )
                            break
                return self._send(200, {"url": url, "via": "launch-file"})

            return self._send(404, {"detail": f"Not found: {path}"})
        except ValueError as exc:
            return self._send(400, {"detail": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"detail": str(exc)})

    def do_DELETE(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        match = re.fullmatch(r"/apps/([^/]+)", path)
        if not match:
            return self._send(404, {"detail": f"Not found: {path}"})
        app_id = urllib.parse.unquote(match.group(1))
        apps = load_apps()
        next_apps = [a for a in apps if a.get("id") != app_id]
        if len(next_apps) == len(apps):
            return self._send(404, {"detail": f"App not installed: {app_id}"})
        save_apps(next_apps)
        return self._send(200, {"apps": next_apps})


def main() -> None:
    data_dir()
    settings = save_settings(load_settings())
    apply_weston_display(settings, restart=False)
    write_chrome_policies(settings)
    apply_time_settings(settings)
    start_power_watchers()
    threading.Thread(target=apply_auto_timezone, daemon=True).start()
    ensure_catalog_cache()
    ensure_shell_overlay()
    # Best-effort remote refresh at startup; offline keeps local cache/overlay.
    sync_catalog_from_remote()
    sync_shell_from_remote()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"blackholed listening on http://{HOST}:{PORT} (dev={DEV_MODE})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    threading.Thread(target=lambda: None).start()
    main()
