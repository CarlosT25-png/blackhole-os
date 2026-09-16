#!/usr/bin/env bash
# Copy missing Chrome ATK/X11 client libs onto a flashed Blackhole SD card.
# Requires the staged libs from a prior agent/build step, or reflash the
# patched nobootloader.wic instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBS="${ROOT}/build/chrome-missing-libs/stage"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo:  sudo $0" >&2
  exit 1
fi

if [[ ! -d "${LIBS}" ]]; then
  echo "Missing ${LIBS}" >&2
  echo "Reflash build/images/*-nobootloader.wic instead (already patched)." >&2
  exit 1
fi

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(eval echo "~${REAL_USER}")"
DOCKER=(sudo -u "$REAL_USER" docker)

echo "==> Looking for Blackhole SD…"
BOOT_DEV=""
for candidate in /dev/disk*s1; do
  [[ -e "$candidate" ]] || continue
  info="$(diskutil info "$candidate" 2>/dev/null || true)"
  echo "$info" | grep -q "File System Personality:.*MS-DOS" || continue
  vol="$(echo "$info" | awk -F': ' '/Volume Name/{print $2}' | xargs)"
  [[ "$vol" == "boot" ]] || continue
  BOOT_DEV="$candidate"
  break
done
[[ -n "${BOOT_DEV}" ]] || { echo "Insert SD and retry" >&2; exit 1; }

DISK="${BOOT_DEV%s*}"
RAW="${DISK/disk/rdisk}"
diskutil unmountDisk force "${DISK}" >/dev/null

TMP="$(sudo -u "$REAL_USER" mktemp -d "${REAL_HOME}/bh-chrome-libs-XXXX")"
cp -a "${LIBS}" "${TMP}/libs"
printf '%s\n' '#!/bin/sh
export CHROME_WRAPPER="$(readlink -f "$0")"
export LD_LIBRARY_PATH="/opt/chromium/lib:/opt/chromium${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec /opt/chromium/chrome --no-sandbox "$@"
' > "${TMP}/chromium-bin"
chown -R "${REAL_USER}" "${TMP}"

patch_one() {
  local raw="$1" name="$2"
  local img="${TMP}/${name}.ext4"
  echo "==> ${name}: reading…"
  dd if="${raw}" of="${img}" bs=4m status=progress
  chown "${REAL_USER}" "${img}"
  echo "==> ${name}: installing libs…"
  "${DOCKER[@]}" run --rm --privileged -v "${TMP}:/work" --entrypoint bash ubuntu:24.04 -c "
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq e2fsprogs util-linux >/dev/null
mkdir -p /mnt/r
mount -o loop /work/${name}.ext4 /mnt/r
mkdir -p /mnt/r/opt/chromium/lib
cp -a /work/libs/. /mnt/r/opt/chromium/lib/
cp /work/chromium-bin /mnt/r/usr/bin/chromium-bin
chmod 755 /mnt/r/usr/bin/chromium-bin
mkdir -p /mnt/r/etc/systemd/system/blackhole-kiosk.service.d
printf '%s\n' '[Service]' \
  'Environment=XDG_RUNTIME_DIR=/run' \
  'Environment=WAYLAND_DISPLAY=wayland-0' \
  'Environment=LD_LIBRARY_PATH=/opt/chromium/lib:/opt/chromium' \
  > /mnt/r/etc/systemd/system/blackhole-kiosk.service.d/wayland.conf
ln -sfn /usr/lib/systemd/system/graphical.target /mnt/r/etc/systemd/system/default.target
sync
umount /mnt/r
"
  echo "==> ${name}: writing…"
  dd if="${img}" of="${raw}" bs=4m status=progress
  rm -f "${img}"
}

patch_one "${RAW}s2" rootA
patch_one "${RAW}s3" rootB
sync
rm -rf "${TMP}"
diskutil eject "${DISK}" >/dev/null 2>&1 || true
echo "Done. Boot the Pi."
