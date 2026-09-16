FILESEXTRAPATHS:prepend := "${THISDIR}/${PN}:"

SRC_URI += "file://blackhole-weston.conf"

do_install:append() {
    install -d ${D}${sysconfdir}/systemd/system/weston.service.d
    install -m 0644 ${WORKDIR}/blackhole-weston.conf \
        ${D}${sysconfdir}/systemd/system/weston.service.d/blackhole.conf
}

FILES:${PN} += "${sysconfdir}/systemd/system/weston.service.d"
