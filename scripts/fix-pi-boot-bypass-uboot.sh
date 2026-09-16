#!/usr/bin/env bash
# Bypass U-Boot on a flashed Blackhole Pi SD card so the firmware loads
# the Linux Image directly as kernel8.img (fixes 4-raspberry + ACT-off hang).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG_DIR="${ROOT}/build/images"

echo "==> Looking for Blackhole boot partition (FAT labeled 'boot')…"
BOOT_DEV=""
for candidate in /dev/disk*s1; do
  [[ -e "$candidate" ]] || continue
  info="$(diskutil info "$candidate" 2>/dev/null || true)"
  echo "$info" | grep -q "File System Personality:.*MS-DOS" || continue
  vol="$(echo "$info" | awk -F': ' '/Volume Name/{print $2}' | xargs)"
  if [[ "${vol}" == "boot" ]]; then
    BOOT_DEV="$candidate"
    break
  fi
done

if [[ -z "${BOOT_DEV}" ]]; then
  echo "No FAT volume named 'boot' found." >&2
  echo "Insert the microSD, wait a few seconds, then re-run:" >&2
  echo "  $0" >&2
  diskutil list external
  exit 1
fi

echo "    Found: ${BOOT_DEV}"
MP="$(mktemp -d /tmp/bh-boot-XXXX)"
cleanup() { diskutil unmount "${BOOT_DEV}" >/dev/null 2>&1 || true; rmdir "${MP}" 2>/dev/null || true; }
trap cleanup EXIT

# Mount read-write
diskutil unmount "${BOOT_DEV}" >/dev/null 2>&1 || true
mount -t msdos "${BOOT_DEV}" "${MP}"

echo "==> Boot partition contents (key files):"
ls -lh "${MP}/kernel8.img" "${MP}/Image" "${MP}/cmdline.txt" "${MP}/config.txt" "${MP}/boot.scr" 2>/dev/null || true

if [[ ! -f "${MP}/Image" ]]; then
  echo "ERROR: Image (Linux kernel) missing on boot partition." >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
echo "==> Backing up U-Boot kernel8.img → kernel8.img.uboot-${TS}"
cp -p "${MP}/kernel8.img" "${MP}/kernel8.img.uboot-${TS}"

echo "==> Installing Linux Image as kernel8.img (skip U-Boot)"
cp -f "${MP}/Image" "${MP}/kernel8.img"

echo "==> Updating cmdline.txt (HDMI console + root on p2)"
printf '%s\n' \
  "dwc_otg.lpm_enable=0 console=tty1 console=serial0,115200 root=/dev/mmcblk0p2 rootfstype=ext4 rootwait net.ifnames=0" \
  > "${MP}/cmdline.txt"
cat "${MP}/cmdline.txt"

echo "==> Ensuring HDMI comes up in config.txt"
if ! grep -q '^hdmi_force_hotplug=' "${MP}/config.txt" 2>/dev/null; then
  printf '\n# Blackhole bring-up\nhdmi_force_hotplug=1\n' >> "${MP}/config.txt"
fi

sync
# Microsoft Defender (and similar) often blocks a normal unmount; force then eject.
if ! diskutil unmount "${BOOT_DEV}"; then
  echo "Normal unmount blocked (often Microsoft Defender); forcing…"
  diskutil unmount force "${BOOT_DEV}" || true
fi
# Eject whole disk (diskXs1 → diskX)
DISK_DEV="${BOOT_DEV%s*}"
diskutil eject "${DISK_DEV}" 2>/dev/null || true
trap - EXIT
rmdir "${MP}" 2>/dev/null || true

echo
echo "Done. Put the card in the Pi and power on."
echo "You should see kernel text on HDMI, then Weston/Chromium."
echo "Note: this bypasses RAUC A/B U-Boot switching until we rebuild with a fixed bootloader."
