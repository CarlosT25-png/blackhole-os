SUMMARY = "Mount persistent Blackhole data partition"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://blackhole-data.mount file://var-lib-blackhole.conf"

S = "${WORKDIR}"

inherit systemd

SYSTEMD_SERVICE:${PN} = "var-lib-blackhole.mount"
SYSTEMD_AUTO_ENABLE = "enable"

do_install() {
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/blackhole-data.mount ${D}${systemd_system_unitdir}/var-lib-blackhole.mount

    install -d ${D}${sysconfdir}/tmpfiles.d
    install -m 0644 ${WORKDIR}/var-lib-blackhole.conf ${D}${sysconfdir}/tmpfiles.d/var-lib-blackhole.conf
}

FILES:${PN} += "${systemd_system_unitdir} ${sysconfdir}/tmpfiles.d"
