SUMMARY = "Blackhole Chromium kiosk session units"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a44d86328cde96c0d0c3"

SRC_URI = " \
    file://blackhole-kiosk.service \
    file://chromium-kiosk.sh \
    file://weston.ini \
"

S = "${WORKDIR}"

inherit systemd

SYSTEMD_SERVICE:${PN} = "blackhole-kiosk.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} = "chromium-ozone-wayland weston weston-init blackhole-extensions"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/chromium-kiosk.sh ${D}${bindir}/chromium-kiosk

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/blackhole-kiosk.service ${D}${systemd_system_unitdir}/blackhole-kiosk.service

    install -d ${D}${sysconfdir}/xdg/weston
    install -m 0644 ${WORKDIR}/weston.ini ${D}${sysconfdir}/xdg/weston/weston.ini
}

FILES:${PN} += "${bindir} ${systemd_system_unitdir} ${sysconfdir}/xdg/weston"
