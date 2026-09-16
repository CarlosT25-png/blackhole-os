#!/usr/bin/env bash
# Refresh Chrome for Testing URL/checksums for chromium-bin recipe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANNEL="${1:-Stable}"
python3 - "${ROOT}" "${CHANNEL}" <<'PY'
import hashlib
import json
import pathlib
import re
import sys
import urllib.request

root = pathlib.Path(sys.argv[1])
channel = sys.argv[2]
data = json.load(urllib.request.urlopen(
    "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
    timeout=60,
))
ver = data["channels"][channel]["version"]
downloads = {
    item["platform"]: item["url"]
    for item in data["channels"][channel]["downloads"]["chrome"]
}
arm = downloads["linux-arm64"]
x64 = downloads["linux64"]

def sha256(url: str) -> str:
    print(f"Downloading {url} …", flush=True)
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=600) as resp:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

arm_sum = sha256(arm)
x64_sum = sha256(x64)
print("arm64", arm_sum)
print("x86_64", x64_sum)

recipe_dir = root / "meta-blackhole/recipes-browser/chromium-bin"
recipe_dir.mkdir(parents=True, exist_ok=True)
# Remove old versioned recipes
for old in recipe_dir.glob("chromium-bin_*.bb"):
    old.unlink()

text = f'''SUMMARY = "Prebuilt Chromium (Chrome for Testing) for Blackhole kiosk"
DESCRIPTION = "Downloads an official linux ARM64/x86_64 Chrome for Testing build instead of compiling Chromium in Yocto."
LICENSE = "BSD-3-Clause & LGPL-2.1-or-later"
LIC_FILES_CHKSUM = "file://${{COMMON_LICENSE_DIR}}/BSD-3-Clause;md5=550794465ba0ec5312d6919e203a55f9"

CFT_VERSION = "{ver}"

SRC_URI:aarch64 = "https://storage.googleapis.com/chrome-for-testing-public/${{CFT_VERSION}}/linux-arm64/chrome-linux-arm64.zip;name=chrome"
SRC_URI:x86-64 = "https://storage.googleapis.com/chrome-for-testing-public/${{CFT_VERSION}}/linux64/chrome-linux64.zip;name=chrome"

SRC_URI[chrome.sha256sum] = "{arm_sum}"
SRC_URI[chrome.sha256sum]:x86-64 = "{x64_sum}"

COMPATIBLE_HOST = "(aarch64|x86_64).*-linux"
COMPATIBLE_MACHINE = "(-)"
COMPATIBLE_MACHINE:aarch64 = "(.*)"
COMPATIBLE_MACHINE:x86-64 = "(.*)"

S = "${{WORKDIR}}"

RDEPENDS:${{PN}} += " \\
    nss \\
    nspr \\
    libxkbcommon \\
    libdrm \\
    mesa \\
    libgbm \\
    wayland \\
    dbus \\
    libexif \\
    pango \\
    cairo \\
    fontconfig \\
    freetype \\
    zlib \\
    libpng \\
    libjpeg-turbo \\
    cups \\
"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {{
    install -d ${{D}}/opt/chromium

    if [ -d ${{WORKDIR}}/chrome-linux-arm64 ]; then
        cp -a ${{WORKDIR}}/chrome-linux-arm64/. ${{D}}/opt/chromium/
    elif [ -d ${{WORKDIR}}/chrome-linux64 ]; then
        cp -a ${{WORKDIR}}/chrome-linux64/. ${{D}}/opt/chromium/
    else
        chrome_bin="$(find ${{WORKDIR}} -maxdepth 3 -type f -name chrome | head -n1)"
        if [ -z "$chrome_bin" ]; then
            bberror "chrome binary not found after unpack"
            exit 1
        fi
        cp -a "$(dirname "$chrome_bin")/." ${{D}}/opt/chromium/
    fi

    chmod 0755 ${{D}}/opt/chromium/chrome

    install -d ${{D}}${{bindir}}
    cat > ${{D}}${{bindir}}/chromium-bin << 'EOF'
#!/bin/sh
export CHROME_WRAPPER="$(readlink -f "$0")"
exec /opt/chromium/chrome --no-sandbox "$@"
EOF
    chmod 0755 ${{D}}${{bindir}}/chromium-bin
    ln -sf chromium-bin ${{D}}${{bindir}}/chromium
}}

FILES:${{PN}} += "/opt/chromium ${{bindir}}"
INSANE_SKIP:${{PN}} += "already-stripped ldflags libdir file-rdeps textrel dev-so"
'''
out = recipe_dir / f"chromium-bin_{ver}.bb"
out.write_text(text)
print("Wrote", out)
PY
