SUMMARY = "Blackhole Chromium kiosk session units"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = " \
    file://blackhole-kiosk.service \
    file://chromium-kiosk.sh \
"

S = "${WORKDIR}"

inherit systemd

SYSTEMD_SERVICE:${PN} = "blackhole-kiosk.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} = "chromium-bin weston weston-init blackhole-extensions"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/chromium-kiosk.sh ${D}${bindir}/chromium-kiosk

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/blackhole-kiosk.service ${D}${systemd_system_unitdir}/blackhole-kiosk.service
}

FILES:${PN} += "${bindir} ${systemd_system_unitdir}"
