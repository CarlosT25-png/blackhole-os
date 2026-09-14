#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"${ROOT}/scripts/sync-catalog.sh"
cd "${ROOT}/apps/shell"
npm ci
npm run build
"${ROOT}/scripts/build-shell-manifest.sh" "${ROOT}/apps/shell/out"
DEST="${ROOT}/meta-blackhole/recipes-core/blackhole-shell/files/shell-out"
rm -rf "${DEST}"
cp -R out "${DEST}"
echo "Synced shell export → ${DEST}"
