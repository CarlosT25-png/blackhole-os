#!/usr/bin/env python3
"""Blackhole OS local API — apps, launch, settings, RAUC updates (stdlib only)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = Path(os.environ.get("BLACKHOLE_DATA", ROOT / "data"))
BUNDLED_CATALOG = Path(
    os.environ.get("BLACKHOLE_CATALOG", ROOT / "catalog" / "apps.json")
)
SHELL_URL = os.environ.get("BLACKHOLE_SHELL_URL", "http://127.0.0.1:3000")
DEFAULT_CHANNEL = os.environ.get(
    "BLACKHOLE_CHANNEL_URL",
    "https://github.com/example/blackhole-os/releases/latest/download/channel.json",
)
DEV_MODE = os.environ.get("BLACKHOLE_DEV", "1") == "1"
DEFAULT_CATALOG_URL = os.environ.get(
    "BLACKHOLE_CATALOG_URL",
    (
        "http://127.0.0.1:3000/catalog/apps.json"
        if DEV_MODE
        else "http://127.0.0.1/catalog/apps.json"
    ),
)
HOST = os.environ.get("BLACKHOLE_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLACKHOLE_PORT", "8081"))
VERSION = os.environ.get("BLACKHOLE_VERSION", "0.1.0-dev")
MACHINE = os.environ.get("BLACKHOLE_MACHINE", "desktop")

DEFAULT_SETTINGS: dict[str, Any] = {
    "channelUrl": DEFAULT_CHANNEL,
    "catalogUrl": DEFAULT_CATALOG_URL,
    "display": {
        "scale": 100,
        "reducedMotion": False,
    },
    "network": {
        "ssid": "",
        "password": "",
        "mode": "dhcp",
    },
}


def data_dir() -> Path:
    path = DEFAULT_DATA
    path.mkdir(parents=True, exist_ok=True)
    return path


def apps_file() -> Path:
    return data_dir() / "apps.json"


def catalog_cache_file() -> Path:
    return data_dir() / "catalog.json"


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
    return deep_merge(DEFAULT_SETTINGS, stored)


def save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    merged = deep_merge(DEFAULT_SETTINGS, settings)
    save_json(settings_file(), merged)
    return merged


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
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
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
            return {"ok": True, "message": f"Connected to {ssid}", "backend": "nmcli"}
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError(str(exc)) from exc

    if DEV_MODE:
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


def bluetooth_action(
    action: str,
    address: str = "",
    powered: bool | None = None,
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
    channel = fetch_json(url)
    remote_version = str(channel.get("version") or "")
    compatible = str(channel.get("compatible") or "")
    bundle_url = str(channel.get("bundleUrl") or "")
    if compatible and compatible != "blackhole-os":
        raise ValueError(f"Incompatible channel: {compatible}")
    if not remote_version or not bundle_url:
        raise ValueError("channel.json needs version and bundleUrl")

    status = update_status_payload()
    newer = is_newer(remote_version, VERSION)
    status["channelUrl"] = url
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
                        },
                        "dev": DEV_MODE,
                        "dataDir": str(data_dir()),
                        "channelUrl": settings.get("channelUrl"),
                        "catalogUrl": settings.get("catalogUrl"),
                        "display": settings.get("display"),
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
                current = load_settings()
                patch = body.get("settings") if isinstance(body.get("settings"), dict) else body
                if not isinstance(patch, dict):
                    return self._send(400, {"detail": "settings object required"})
                saved = save_settings(deep_merge(current, patch))
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
                current = load_settings()
                patch = body.get("settings") if isinstance(body.get("settings"), dict) else body
                if not isinstance(patch, dict):
                    return self._send(400, {"detail": "settings object required"})
                saved = save_settings(deep_merge(current, patch))
                return self._send(200, {"settings": saved})

            if path == "/network":
                body = self._read_json()
                ssid = str(body.get("ssid", "")).strip()
                password = str(body.get("password", ""))
                if not ssid:
                    return self._send(400, {"detail": "ssid is required"})
                settings = load_settings()
                settings["network"] = {
                    "ssid": ssid,
                    "password": password,
                    "mode": str(body.get("mode") or "dhcp"),
                }
                save_settings(settings)
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
                result = bluetooth_action(
                    action,
                    str(body.get("address") or ""),
                    powered if isinstance(powered, bool) else None,
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
    save_settings(load_settings())
    ensure_catalog_cache()
    # Best-effort remote refresh at startup; offline keeps local cache.
    sync_catalog_from_remote()
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
