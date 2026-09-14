SUMMARY = "Blackhole local API daemon"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a44d86328cde96c0d0c3"

SRC_URI = " \
    file://blackholed.py \
    file://blackholed.service \
    file://apps.json \
"

S = "${WORKDIR}"

RDEPENDS:${PN} = " \
    python3 \
    python3-json \
    python3-urllib \
    python3-threading \
    python3-subprocess \
"

inherit systemd

SYSTEMD_SERVICE:${PN} = "blackholed.service"
SYSTEMD_AUTO_ENABLE = "enable"

do_install() {
    install -d ${D}${libdir}/blackhole
    install -m 0755 ${WORKDIR}/blackholed.py ${D}${libdir}/blackhole/blackholed.py

    install -d ${D}${sysconfdir}/blackhole
    install -m 0644 ${WORKDIR}/apps.json ${D}${sysconfdir}/blackhole/catalog.json

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${WORKDIR}/blackholed.service ${D}${systemd_system_unitdir}/blackholed.service

    install -d ${D}${localstatedir}/lib/blackhole
}

FILES:${PN} += " \
    ${libdir}/blackhole \
    ${sysconfdir}/blackhole \
    ${localstatedir}/lib/blackhole \
    ${systemd_system_unitdir} \
"
