#!/usr/bin/env bash
# Fix emergency-mode boot caused by meta-rauc-raspberrypi fstab
# (duplicate /boot + missing mmcblk0p5/p6) on an already-flashed SD card.
#
# Docker Desktop on Mac cannot use /dev/disk* or root-owned /tmp mounts —
# we dd each rootfs to a file under the user home, patch in a container, dd back.
set -euo pipefail

FSTAB='# Blackhole OS — p1 boot, p2/p3 root A/B, p4 bhdata
/dev/root            /                    auto       defaults              1  1
proc                 /proc                proc       defaults              0  0
devpts               /dev/pts             devpts     mode=0620,ptmxmode=0666,gid=5      0  0
tmpfs                /run                 tmpfs      mode=0755,nodev,nosuid,strictatime 0  0
tmpfs                /var/volatile        tmpfs      defaults              0  0

/dev/disk/by-label/boot    /boot                vfat    defaults,nofail  0  0
/dev/disk/by-label/bhdata  /var/lib/blackhole   ext4    defaults,nofail  0  0
'

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo:  sudo $0" >&2
  exit 1
fi

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(eval echo "~${REAL_USER}")"
DOCKER=(sudo -u "$REAL_USER" docker)

echo "==> Looking for Blackhole SD (FAT labeled 'boot')…"
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

if [[ -z "${BOOT_DEV}" ]]; then
  echo "Insert the microSD and re-run: sudo $0" >&2
  diskutil list external
  exit 1
fi

DISK="${BOOT_DEV%s*}"
RAW="${DISK/disk/rdisk}"
ROOT_A="${DISK}s2"
ROOT_B="${DISK}s3"
RAW_A="${RAW}s2"
RAW_B="${RAW}s3"

for node in "$ROOT_A" "$ROOT_B" "$RAW_A" "$RAW_B"; do
  if [[ ! -e "$node" ]]; then
    echo "Missing $node — is this a Blackhole dual-root image?" >&2
    diskutil list "$DISK"
    exit 1
  fi
done

echo "    disk=${DISK}  rootA=${ROOT_A}  rootB=${ROOT_B}"

echo "==> Unmounting ${DISK}…"
diskutil unmountDisk force "${DISK}" >/dev/null

# Must live under /Users/... so Docker Desktop can bind-mount it.
TMP="$(sudo -u "$REAL_USER" mktemp -d "${REAL_HOME}/bh-fstab-XXXX")"
cleanup() {
  # Keep images on failure for faster retry; remove on success only.
  :
}
trap cleanup EXIT

printf '%s\n' "$FSTAB" > "${TMP}/fstab"
chown -R "${REAL_USER}" "${TMP}"

patch_one() {
  local raw_dev="$1"
  local name="$2"
  local img="${TMP}/${name}.ext4"

  if [[ -f "${img}" ]]; then
    local expect
    expect="$(diskutil info "${raw_dev/rdisk/disk}" 2>/dev/null | awk -F'[: ]+' '/Disk Size/{print $3; exit}')" || true
    echo "==> Reusing existing ${img}"
  else
    echo "==> Reading ${raw_dev} → ${name}.ext4 (a few minutes)…"
    dd if="${raw_dev}" of="${img}" bs=4m status=progress
    chown "${REAL_USER}" "${img}"
  fi

  echo "==> Patching fstab inside ${name}…"
  "${DOCKER[@]}" run --rm --privileged \
    -v "${TMP}:/work" \
    --entrypoint bash ubuntu:24.04 -c "
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq e2fsprogs util-linux >/dev/null
mkdir -p /mnt/root
mount -o loop /work/${name}.ext4 /mnt/root
cp /work/fstab /mnt/root/etc/fstab
echo '--- /etc/fstab ---'
cat /mnt/root/etc/fstab
sync
umount /mnt/root
"

  echo "==> Writing ${name}.ext4 → ${raw_dev}…"
  dd if="${img}" of="${raw_dev}" bs=4m status=progress
  rm -f "${img}"
}

patch_one "${RAW_A}" "rootA"
patch_one "${RAW_B}" "rootB"

sync
rm -rf "${TMP}"
diskutil eject "${DISK}" >/dev/null 2>&1 || true

echo
echo "Done. Put the card in the Pi and power on."
