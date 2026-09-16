#!/usr/bin/env bash
# Build a flashable Blackhole OS image for Raspberry Pi via Docker + kas.
#
# Usage:
#   ./scripts/build-rpi-image.sh              # Pi 4 64-bit (default)
#   ./scripts/build-rpi-image.sh pi4
#   ./scripts/build-rpi-image.sh pi5
#
# Requires: Docker Desktop running.
# Recommended Docker resources: 16 GB RAM, 4+ CPUs, ~100 GB free disk.
# First build with prebuilt Chromium: expect ~1–3 hours.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-pi4}"
KAS_IMAGE="${KAS_IMAGE:-ghcr.io/siemens/kas/kas:4.7}"
LOWMEM="${BLACKHOLE_LOWMEM:-auto}"

case "${TARGET}" in
  pi4|raspberrypi4|raspberrypi4-64)
    KAS_CONFIG="kas/raspberrypi4-64.yml"
    MACHINE="raspberrypi4-64"
    ;;
  pi5|raspberrypi5)
    KAS_CONFIG="kas/raspberrypi5.yml"
    MACHINE="raspberrypi5"
    ;;
  *)
    echo "Unknown target: ${TARGET}" >&2
    echo "Use: pi4 | pi5" >&2
    exit 1
    ;;
esac

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running." >&2
  echo "Open Docker Desktop, wait until it is ready, then re-run:" >&2
  echo "  ./scripts/build-rpi-image.sh ${TARGET}" >&2
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open -a Docker 2>/dev/null || true
  fi
  exit 1
fi

DOCKER_MEM_GIB="$(
  docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}'
)"
echo "Docker reports ~${DOCKER_MEM_GIB:-?} GiB RAM"

KAS_FILES="${KAS_CONFIG}"
if [[ "${LOWMEM}" == "1" ]] || { [[ "${LOWMEM}" == "auto" ]] && [[ "${DOCKER_MEM_GIB:-0}" -lt 8 ]]; }; then
  echo "WARNING: Docker RAM is under 8 GiB. Enabling lowmem bitbake settings."
  echo "         Docker Desktop → Settings → Resources → Memory → 8 GB+ recommended."
  KAS_FILES="${KAS_CONFIG}:kas/lowmem.yml"
elif [[ "${BLACKHOLE_DOCKER_DESKTOP:-auto}" == "1" ]] \
  || { [[ "${BLACKHOLE_DOCKER_DESKTOP:-auto}" == "auto" ]] && [[ "$(uname -s)" == "Darwin" ]]; }; then
  echo "Using Docker Desktop-safe parallelism (kas/docker-desktop.yml, -j4)."
  echo "    Override with BLACKHOLE_DOCKER_DESKTOP=0 on a big Linux builder."
  KAS_FILES="${KAS_CONFIG}:kas/docker-desktop.yml"
fi

echo "==> Syncing shell export into meta-blackhole"
if [[ "${SKIP_SHELL_SYNC:-0}" == "1" ]]; then
  echo "    (skipped: SKIP_SHELL_SYNC=1)"
else
  "${ROOT}/scripts/sync-shell-to-recipe.sh"
fi

mkdir -p "${ROOT}/build" "${ROOT}/downloads" "${ROOT}/sstate-cache" "${ROOT}/build/images"

# Yocto refuses TMPDIR on case-insensitive filesystems (default macOS APFS).
# Keep downloads/sstate on the host bind-mount; put tmp on a Linux Docker volume.
TMP_VOLUME="blackhole-os-tmp-${MACHINE}"
echo "==> Ensuring case-sensitive TMPDIR volume: ${TMP_VOLUME}"
docker volume create "${TMP_VOLUME}" >/dev/null
# Image USER is "builder"; volume dirs default to root:root. Make writable for --user 1000:1000.
docker run --rm --user 0:0 --entrypoint sh \
  -v "${TMP_VOLUME}:/tmpdir" \
  "${KAS_IMAGE}" \
  -c 'chmod 777 /tmpdir'

echo "==> Pulling kas image: ${KAS_IMAGE}"
docker pull "${KAS_IMAGE}"

echo "==> Building ${MACHINE}"
echo "    Config: ${KAS_FILES}"
echo "    Uses prebuilt Chromium (chrome-for-testing); expect ~1–3 hours on first run."

# Docker Desktop often runs with user namespaces, so kas's entrypoint cannot
# groupmod/usermod the "builder" user (and fake-root still looks like uid 0 to
# bitbake, which refuses). Skip the entrypoint and run kas as a fixed
# unprivileged uid that bitbake accepts.
chmod -R a+rwX "${ROOT}/build" "${ROOT}/downloads" "${ROOT}/sstate-cache" 2>/dev/null || true

docker run --rm -t \
  --name "blackhole-kas-${MACHINE}" \
  --user 1000:1000 \
  --entrypoint kas \
  -e "HOME=/tmp/builder-home" \
  -e "DL_DIR=/work/downloads" \
  -e "SSTATE_DIR=/work/sstate-cache" \
  -e "BB_ENV_PASSTHROUGH_ADDITIONS=DL_DIR SSTATE_DIR" \
  -v "${ROOT}:/work" \
  -v "${TMP_VOLUME}:/work/build/tmp" \
  -w /work \
  "${KAS_IMAGE}" \
  build "${KAS_FILES}"

echo
echo "==> Copying flashable artifacts out of Docker volume…"
mkdir -p "${ROOT}/build/images"
docker run --rm \
  --user 1000:1000 \
  --entrypoint sh \
  -v "${TMP_VOLUME}:/tmpdir:ro" \
  -v "${ROOT}/build/images:/out" \
  "${KAS_IMAGE}" \
  -c 'mkdir -p /out && find /tmpdir/deploy/images -type f \( -name "blackhole-image*.wic*" -o -name "blackhole-image*.bmap" -o -name "*.wic.gz" \) -exec cp -v {} /out/ \; 2>/dev/null || true'

echo
echo "==> Looking for flashable artifacts…"
find "${ROOT}/build/images" -type f \( -name 'blackhole-image*.wic*' -o -name '*.wic.gz' \) \
  2>/dev/null | sort | tee "${ROOT}/build/LAST_IMAGES.txt" || true

echo
echo "Flash on macOS (replace diskN from diskutil list — use rdiskN for speed):"
echo "  diskutil unmountDisk /dev/diskN"
echo "  sudo dd if=IMAGE.wic of=/dev/rdiskN bs=4m status=progress"
echo "  sync"
