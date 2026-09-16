SUMMARY = "Prebuilt Chromium (Chrome for Testing) for Blackhole kiosk"
DESCRIPTION = "Downloads an official linux ARM64/x86_64 Chrome for Testing build instead of compiling Chromium in Yocto."
LICENSE = "BSD-3-Clause & LGPL-2.1-or-later"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/BSD-3-Clause;md5=550794465ba0ec5312d6919e203a55f9"

CFT_VERSION = "153.0.8010.36"

SRC_URI:aarch64 = "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VERSION}/linux-arm64/chrome-linux-arm64.zip;name=chrome_arm"
SRC_URI:x86-64 = "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VERSION}/linux64/chrome-linux64.zip;name=chrome_x86"

SRC_URI[chrome_arm.sha256sum] = "dfc4955719c5d494c8507990506d2d5bed174c31bf89266aa2dc5593c6607e8b"
SRC_URI[chrome_x86.sha256sum] = "167a098c4fdec156b58a9f678c90a84f9072d789f9c6e7b35496a6987b8b7ef8"

COMPATIBLE_HOST = "(aarch64|x86_64).*-linux"
COMPATIBLE_MACHINE = "(-)"
COMPATIBLE_MACHINE:aarch64 = "(.*)"
COMPATIBLE_MACHINE:x86-64 = "(.*)"

S = "${WORKDIR}"

RDEPENDS:${PN} += " \
    nss \
    nspr \
    libxkbcommon \
    libdrm \
    mesa \
    libgbm \
    wayland \
    dbus \
    libexif \
    pango \
    cairo \
    fontconfig \
    freetype \
    zlib \
    libpng \
    libjpeg-turbo \
    cups \
    atk \
    at-spi2-atk \
    at-spi2-core \
    libx11 \
    libxext \
    libxcomposite \
    libxdamage \
    libxfixes \
    libxrandr \
    libxcb \
    alsa-lib \
"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}/opt/chromium

    # Do not preserve host UIDs from the Chrome for Testing zip / WORKDIR
    # (breaks do_package OEOuthashBasic: "doesn't match any user/group on target").
    if [ -d ${WORKDIR}/chrome-linux-arm64 ]; then
        cp -a --no-preserve=ownership ${WORKDIR}/chrome-linux-arm64/. ${D}/opt/chromium/
    elif [ -d ${WORKDIR}/chrome-linux64 ]; then
        cp -a --no-preserve=ownership ${WORKDIR}/chrome-linux64/. ${D}/opt/chromium/
    else
        chrome_bin="$(find ${WORKDIR} -maxdepth 3 -type f -name chrome | head -n1)"
        if [ -z "$chrome_bin" ]; then
            bberror "chrome binary not found after unpack"
            exit 1
        fi
        cp -a --no-preserve=ownership "$(dirname "$chrome_bin")/." ${D}/opt/chromium/
    fi

    chown -R root:root ${D}/opt/chromium
    chmod 0755 ${D}/opt/chromium/chrome

    install -d ${D}${bindir}
    # --disable-infobars hides the "Chrome for Testing" banner (CfT builds).
    cat > ${D}${bindir}/chromium-bin << 'EOF'
#!/bin/sh
export CHROME_WRAPPER="$(readlink -f "$0")"
export LD_LIBRARY_PATH="/opt/chromium/lib:/opt/chromium${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec /opt/chromium/chrome --no-sandbox --disable-infobars "$@"
EOF
    chmod 0755 ${D}${bindir}/chromium-bin
    ln -sf chromium-bin ${D}${bindir}/chromium
}

FILES:${PN} += "/opt/chromium ${bindir}"
INSANE_SKIP:${PN} += "already-stripped ldflags libdir file-rdeps textrel dev-so"
