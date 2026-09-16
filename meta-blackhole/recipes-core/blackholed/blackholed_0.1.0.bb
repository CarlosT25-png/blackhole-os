SUMMARY = "Blackhole local API daemon"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = " \
    file://blackholed.py \
    file://blackholed.service \
    file://apps.json \
    file://90-blackhole-timesync \
"

S = "${WORKDIR}"

RDEPENDS:${PN} = " \
    python3-core \
    python3-json \
    python3-datetime \
    python3-netclient \
    python3-threading \
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

    install -d ${D}${sysconfdir}/NetworkManager/dispatcher.d
    install -m 0755 ${WORKDIR}/90-blackhole-timesync ${D}${sysconfdir}/NetworkManager/dispatcher.d/90-blackhole-timesync

    install -d ${D}${localstatedir}/lib/blackhole
}

FILES:${PN} += " \
    ${libdir}/blackhole \
    ${sysconfdir}/blackhole \
    ${sysconfdir}/NetworkManager/dispatcher.d \
    ${localstatedir}/lib/blackhole \
    ${systemd_system_unitdir} \
"
