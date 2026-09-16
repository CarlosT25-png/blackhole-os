SUMMARY = "Blackhole Next.js kiosk shell (static export)"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

# Pre-built static export is expected at files/shell-out (produced by
# `npm run build` in apps/shell). CI / kas should populate this before bitbake.
SRC_URI = "file://shell-out/ \
           file://nginx-blackhole.conf \
"

S = "${WORKDIR}"

inherit allarch

DEPENDS += "nginx"
RDEPENDS:${PN} = "nginx"

do_install() {
    install -d ${D}/usr/share/blackhole/shell
    if [ -d ${WORKDIR}/shell-out ]; then
        cp -R ${WORKDIR}/shell-out/. ${D}/usr/share/blackhole/shell/
    else
        # Minimal placeholder so the image still builds before the shell is exported.
        echo '<!doctype html><meta charset=utf-8><title>Blackhole</title><p>Build apps/shell</p>' \
            > ${D}/usr/share/blackhole/shell/index.html
    fi

    install -d ${D}${sysconfdir}/nginx/conf.d
    install -m 0644 ${WORKDIR}/nginx-blackhole.conf ${D}${sysconfdir}/nginx/conf.d/blackhole.conf
}

FILES:${PN} += "/usr/share/blackhole/shell ${sysconfdir}/nginx/conf.d"
