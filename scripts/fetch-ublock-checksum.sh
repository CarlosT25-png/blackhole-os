#!/usr/bin/env bash
# Download uBlock Origin and print / update the recipe checksum.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:-1.62.0}"
URL="https://github.com/gorhill/uBlock/releases/download/${VER}/uBlock0_${VER}.chromium.zip"
TMP="$(mktemp)"
curl -fsSL "${URL}" -o "${TMP}"
SUM="$(shasum -a 256 "${TMP}" | awk '{print $1}')"
echo "SRC_URI[ublock.sha256sum] = \"${SUM}\""
RECIPE="${ROOT}/meta-blackhole/recipes-browser/chromium/blackhole-extensions_0.1.0.bb"
if [[ -f "${RECIPE}" ]]; then
  if grep -q 'SRC_URI\[ublock.sha256sum\]' "${RECIPE}"; then
    sed -i.bak "s/SRC_URI\[ublock.sha256sum\] = \".*\"/SRC_URI[ublock.sha256sum] = \"${SUM}\"/" "${RECIPE}"
    rm -f "${RECIPE}.bak"
    echo "Updated ${RECIPE}"
  fi
fi
rm -f "${TMP}"
