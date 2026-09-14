SUMMARY = "Chromium extensions for Blackhole (uBlock Origin + kiosk-bridge)"
LICENSE = "Apache-2.0 & GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a44d86328cde96c0d0c3"

# uBlock Origin Chromium build (pinned). kiosk-bridge ships in-tree.
SRC_URI = " \
    https://github.com/gorhill/uBlock/releases/download/1.62.0/uBlock0_1.62.0.chromium.zip;name=ublock;subdir=ublock-src \
    file://kiosk-bridge/ \
"

SRC_URI[ublock.sha256sum] = "e714fe2d033b672f0b134954a293d67ce97999269ecb2f0d34b9765e5d45e62a"

# NOTE: The sha256 above is a placeholder replaced by scripts/fetch-ublock-checksum.sh
# during packaging. For reproducible builds, run that script and update this recipe.
# Until then, allow unpack via a local mirror or set BB_STRICT_CHECKSUM = "0" in local.

S = "${WORKDIR}"

inherit allarch

do_install() {
    install -d ${D}/usr/share/chromium/extensions/ublock
    install -d ${D}/usr/share/chromium/extensions/kiosk-bridge

    # uBlock zip layout varies; find manifest.json
    if [ -f ${WORKDIR}/ublock-src/manifest.json ]; then
        cp -R ${WORKDIR}/ublock-src/. ${D}/usr/share/chromium/extensions/ublock/
    else
        ublock_root="$(find ${WORKDIR}/ublock-src -maxdepth 3 -name manifest.json | head -n1 || true)"
        if [ -n "$ublock_root" ]; then
            cp -R "$(dirname "$ublock_root")/." ${D}/usr/share/chromium/extensions/ublock/
        else
            bberror "uBlock Origin manifest.json not found after unpack"
            exit 1
        fi
    fi

    cp -R ${WORKDIR}/kiosk-bridge/. ${D}/usr/share/chromium/extensions/kiosk-bridge/
}

FILES:${PN} += "/usr/share/chromium/extensions"
