SUMMARY = "Chromium extensions for Blackhole (uBlock Origin Lite + kiosk-bridge)"
LICENSE = "Apache-2.0 & GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a44d86328cde96c0d0c3"

# uBlock Origin Lite (MV3). Modern Chromium rejects Manifest V2 uBlock Origin.
SRC_URI = " \
    https://github.com/uBlockOrigin/uBOL-home/releases/download/2026.825.1619/uBOLite_2026.825.1619.chromium.zip;name=ublock;subdir=ublock-src \
    file://kiosk-bridge/ \
"

SRC_URI[ublock.sha256sum] = "9f0acbe3eabd4ba1c1c0629438cfacafbdaf04cd150769932d5d265b2fac117e"

S = "${WORKDIR}"

inherit allarch

do_install() {
    install -d ${D}/usr/share/chromium/extensions/ublock
    install -d ${D}/usr/share/chromium/extensions/kiosk-bridge

    if [ -f ${WORKDIR}/ublock-src/manifest.json ]; then
        cp -R ${WORKDIR}/ublock-src/. ${D}/usr/share/chromium/extensions/ublock/
    else
        ublock_root="$(find ${WORKDIR}/ublock-src -maxdepth 3 -name manifest.json | head -n1 || true)"
        if [ -n "$ublock_root" ]; then
            cp -R "$(dirname "$ublock_root")/." ${D}/usr/share/chromium/extensions/ublock/
        else
            bberror "uBlock Origin Lite manifest.json not found after unpack"
            exit 1
        fi
    fi

    cp -R ${WORKDIR}/kiosk-bridge/. ${D}/usr/share/chromium/extensions/kiosk-bridge/
}

FILES:${PN} += "/usr/share/chromium/extensions"
