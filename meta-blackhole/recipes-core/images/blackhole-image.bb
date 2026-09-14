SUMMARY = "Blackhole OS kiosk image"
DESCRIPTION = "Wayland kiosk with Chromium, uBlock Origin, Next.js shell, blackholed, and RAUC."
LICENSE = "Apache-2.0"

inherit core-image

IMAGE_FEATURES += " \
    ssh-server-openssh \
    package-management \
"

IMAGE_INSTALL += " \
    packagegroup-core-boot \
    kernel-modules \
    weston \
    weston-init \
    chromium-ozone-wayland \
    nginx \
    python3 \
    ca-certificates \
    blackhole-shell \
    blackholed \
    blackhole-session \
    blackhole-extensions \
    rauc \
    ${@bb.utils.contains('DISTRO_FEATURES', 'wifi', 'wpa-supplicant', '', d)} \
"

# Persist app data and Chromium profile on the data partition.
IMAGE_INSTALL:append = " blackhole-data-mount"

ROOTFS_POSTPROCESS_COMMAND:append = " blackhole_disable_weston_desktop; "

blackhole_disable_weston_desktop() {
    # Prefer our kiosk session over a full desktop shell if present.
    if [ -f ${IMAGE_ROOTFS}${sysconfdir}/xdg/weston/weston.ini ]; then
        sed -i '/^\[shell\]/,/^\[/{s/^locking=.*/locking=false/}' ${IMAGE_ROOTFS}${sysconfdir}/xdg/weston/weston.ini || true
    fi
}
