#!/usr/bin/env bash
# Copy the canonical store catalog into the Next.js public tree (and optional Yocto recipe).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/catalog/apps.json"
DEST_DIR="${ROOT}/apps/shell/public/catalog"
DEST="${DEST_DIR}/apps.json"
RECIPE="${ROOT}/meta-blackhole/recipes-core/blackholed/files/apps.json"

if [[ ! -f "${SRC}" ]]; then
  echo "Missing catalog source: ${SRC}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
cp "${SRC}" "${DEST}"
echo "Synced catalog → ${DEST}"

if [[ -d "$(dirname "${RECIPE}")" ]]; then
  cp "${SRC}" "${RECIPE}"
  echo "Synced catalog → ${RECIPE}"
fi
