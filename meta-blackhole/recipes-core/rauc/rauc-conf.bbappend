FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# Provide machine-specific system.conf as the file name rauc-conf expects.
SRC_URI:append = " \
    file://devel-ca.cert.pem;name=blackhole-ca \
"

SRC_URI:append:raspberrypi4-64 = " file://system.conf.raspberrypi;destsuffix=rauc-conf"
SRC_URI:append:raspberrypi5 = " file://system.conf.raspberrypi;destsuffix=rauc-conf"
SRC_URI:append:raspberrypi4 = " file://system.conf.raspberrypi;destsuffix=rauc-conf"
SRC_URI:append:genericx86-64 = " file://system.conf.x86;destsuffix=rauc-conf"
SRC_URI:append:qemux86-64 = " file://system.conf.x86;destsuffix=rauc-conf"

# Default for unknown machines: Raspberry Pi layout
SRC_URI:append = " file://system.conf.raspberrypi"

do_install:prepend() {
    # Normalize names expected by rauc-conf / documentation.
    if [ -f ${WORKDIR}/system.conf.raspberrypi ] && [ ! -f ${WORKDIR}/system.conf ]; then
        cp ${WORKDIR}/system.conf.raspberrypi ${WORKDIR}/system.conf
    fi
    if [ -f ${WORKDIR}/system.conf.x86 ]; then
        case "${MACHINE}" in
            genericx86-64|qemux86-64)
                cp ${WORKDIR}/system.conf.x86 ${WORKDIR}/system.conf
                ;;
        esac
    fi
    if [ -f ${WORKDIR}/devel-ca.cert.pem ]; then
        cp ${WORKDIR}/devel-ca.cert.pem ${WORKDIR}/ca.cert.pem
    fi
}
