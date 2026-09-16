#!/usr/bin/env bash
# Patch a flashed Blackhole Pi SD card with latest runtime files — no Yocto rebuild.
#
# Updates both root slots (A/B):
#   - blackholed.py
#   - chromium-kiosk.sh + blackhole-kiosk.service
#   - kiosk-bridge extension
#   - weston.ini (+ weston.service.d drop-in)
#   - baked shell UI (/usr/share/blackhole/shell)
#
# Also refreshes the offline shell overlay on the bhdata partition when present.
#
# Cannot add new packages (mesa-megadriver, libva, v4l-utils) or kernel cmdline
# (cma=256M / DISABLE_OVERSCAN) without a rebuild or separate boot edits.
#
# Usage:
#   sudo ./scripts/patch-sd-runtime.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo:  sudo $0" >&2
  exit 1
fi

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(eval echo "~${REAL_USER}")"
DOCKER=(sudo -u "$REAL_USER" docker)

need() {
  local path="$1"
  if [[ ! -e "${path}" ]]; then
    echo "Missing ${path}" >&2
    exit 1
  fi
}

need "${ROOT}/services/blackholed/blackholed.py"
need "${ROOT}/meta-blackhole/recipes-core/blackhole-session/files/chromium-kiosk.sh"
need "${ROOT}/meta-blackhole/recipes-core/blackhole-session/files/blackhole-kiosk.service"
need "${ROOT}/extensions/kiosk-bridge/content.js"
need "${ROOT}/meta-blackhole/recipes-graphics/wayland/weston-init/weston.ini"
need "${ROOT}/meta-blackhole/recipes-core/blackhole-shell/files/shell-out"

if ! "${DOCKER[@]}" info >/dev/null 2>&1; then
  echo "Docker is not running. Open Docker Desktop, wait until it is ready, then retry." >&2
  echo "  open -a Docker" >&2
  exit 1
fi

echo "==> Looking for Blackhole SD…"
BOOT_DEV=""
for candidate in /dev/disk*s1; do
  [[ -e "$candidate" ]] || continue
  info="$(diskutil info "$candidate" 2>/dev/null || true)"
  echo "$info" | grep -q "File System Personality:.*MS-DOS" || continue
  vol="$(echo "$info" | awk -F': ' '/Volume Name/{print $2}' | xargs)"
  vol_lc="$(printf '%s' "$vol" | tr '[:upper:]' '[:lower:]')"
  [[ "$vol_lc" == "boot" ]] || continue
  BOOT_DEV="$candidate"
  break
done
[[ -n "${BOOT_DEV}" ]] || {
  echo "Insert the Blackhole SD card and retry." >&2
  exit 1
}

DISK="${BOOT_DEV%s*}"
RAW="${DISK/disk/rdisk}"
echo "    Found boot volume '${vol}' on ${BOOT_DEV} (disk ${DISK})"

diskutil unmountDisk force "${DISK}" >/dev/null

TMP="$(sudo -u "$REAL_USER" mktemp -d "${REAL_HOME}/bh-patch-XXXX")"
STAGE="${TMP}/stage"
mkdir -p \
  "${STAGE}/blackholed" \
  "${STAGE}/session" \
  "${STAGE}/kiosk-bridge" \
  "${STAGE}/weston" \
  "${STAGE}/weston-dropin" \
  "${STAGE}/shell"

cp "${ROOT}/services/blackholed/blackholed.py" "${STAGE}/blackholed/"
cp "${ROOT}/catalog/apps.json" "${STAGE}/blackholed/catalog.json"
cp "${ROOT}/meta-blackhole/recipes-core/blackhole-session/files/chromium-kiosk.sh" "${STAGE}/session/"
cp "${ROOT}/meta-blackhole/recipes-core/blackhole-session/files/blackhole-kiosk.service" "${STAGE}/session/"
cp -R "${ROOT}/extensions/kiosk-bridge/." "${STAGE}/kiosk-bridge/"
cp "${ROOT}/meta-blackhole/recipes-graphics/wayland/weston-init/weston.ini" "${STAGE}/weston/"
cp "${ROOT}/meta-blackhole/recipes-graphics/wayland/weston-init/blackhole-weston.conf" \
  "${STAGE}/weston-dropin/blackhole.conf"
# shell-out may be large; copy with rsync-like cp -a
cp -R "${ROOT}/meta-blackhole/recipes-core/blackhole-shell/files/shell-out/." "${STAGE}/shell/"
chown -R "${REAL_USER}" "${TMP}"

patch_root() {
  local raw="$1" name="$2"
  local img="${TMP}/${name}.ext4"
  if [[ ! -e "${raw}" ]]; then
    echo "==> Skip ${name}: ${raw} missing"
    return 0
  fi
  echo "==> ${name}: reading partition…"
  dd if="${raw}" of="${img}" bs=4m status=progress
  chown "${REAL_USER}" "${img}"
  echo "==> ${name}: applying runtime files…"
  "${DOCKER[@]}" run --rm --privileged -v "${TMP}:/work" --entrypoint bash ubuntu:24.04 -c "
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq e2fsprogs util-linux >/dev/null
mkdir -p /mnt/r
mount -o loop /work/${name}.ext4 /mnt/r

install -d /mnt/r/usr/lib/blackhole
install -m 0644 /work/stage/blackholed/blackholed.py /mnt/r/usr/lib/blackhole/blackholed.py

install -d /mnt/r/etc/blackhole
install -m 0644 /work/stage/blackholed/catalog.json /mnt/r/etc/blackhole/catalog.json

install -d /mnt/r/usr/bin
install -m 0755 /work/stage/session/chromium-kiosk.sh /mnt/r/usr/bin/chromium-kiosk

install -d /mnt/r/usr/lib/systemd/system
install -m 0644 /work/stage/session/blackhole-kiosk.service \\
  /mnt/r/usr/lib/systemd/system/blackhole-kiosk.service

install -d /mnt/r/usr/share/chromium/extensions/kiosk-bridge
rm -rf /mnt/r/usr/share/chromium/extensions/kiosk-bridge/*
cp -a /work/stage/kiosk-bridge/. /mnt/r/usr/share/chromium/extensions/kiosk-bridge/

install -d /mnt/r/etc/xdg/weston
install -m 0644 /work/stage/weston/weston.ini /mnt/r/etc/xdg/weston/weston.ini

install -d /mnt/r/etc/systemd/system/weston.service.d
install -m 0644 /work/stage/weston-dropin/blackhole.conf \\
  /mnt/r/etc/systemd/system/weston.service.d/blackhole.conf

install -d /mnt/r/usr/share/blackhole/shell
rm -rf /mnt/r/usr/share/blackhole/shell/*
cp -a /work/stage/shell/. /mnt/r/usr/share/blackhole/shell/

# Keep kiosk LD_LIBRARY_PATH if a prior chrome-libs patch installed it.
install -d /mnt/r/etc/systemd/system/blackhole-kiosk.service.d

sync
umount /mnt/r
"
  echo "==> ${name}: writing partition…"
  dd if="${img}" of="${raw}" bs=4m status=progress
  rm -f "${img}"
}

patch_bhdata() {
  local raw="$1"
  local img="${TMP}/bhdata.ext4"
  if [[ ! -e "${raw}" ]]; then
    echo "==> Skip bhdata: ${raw} missing"
    return 0
  fi
  echo "==> bhdata: refreshing shell overlay…"
  dd if="${raw}" of="${img}" bs=4m status=progress
  chown "${REAL_USER}" "${img}"
  "${DOCKER[@]}" run --rm --privileged -v "${TMP}:/work" --entrypoint bash ubuntu:24.04 -c "
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq e2fsprogs util-linux >/dev/null
mkdir -p /mnt/d
mount -o loop /work/bhdata.ext4 /mnt/d
install -d /mnt/d/shell
rm -rf /mnt/d/shell/*
cp -a /work/stage/shell/. /mnt/d/shell/
# Drop stale shell-version so next blackholed start re-seeds cleanly if needed.
rm -f /mnt/d/shell-version.json
# Refresh offline catalog cache (installed apps.json is left alone).
install -m 0644 /work/stage/blackholed/catalog.json /mnt/d/catalog.json
sync
umount /mnt/d
"  echo "==> bhdata: writing partition…"
  dd if="${img}" of="${raw}" bs=4m status=progress
  rm -f "${img}"
}

# Dual-slot layout: s2=rootA, s3=rootB, s4=bhdata (see prior diskutil layout).
patch_root "${RAW}s2" rootA
patch_root "${RAW}s3" rootB
patch_bhdata "${RAW}s4"

sync
rm -rf "${TMP}"
diskutil eject "${DISK}" >/dev/null 2>&1 || true

echo
echo "Done. Boot the Pi."
echo "Patched without rebuild: shell UI, catalog, blackholed, kiosk launcher/policies,"
echo "kiosk-bridge (Home + adblock), Weston ini."
echo
echo "Still needs a rebuild for: mesa-megadriver / libva / v4l packages,"
echo "Pi cmdline cma=256M, DISABLE_OVERSCAN."
