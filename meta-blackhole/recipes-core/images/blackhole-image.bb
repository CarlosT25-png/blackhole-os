SUMMARY = "Blackhole OS kiosk image"
DESCRIPTION = "Wayland kiosk with prebuilt Chromium, Next.js shell, blackholed, and RAUC."
LICENSE = "Apache-2.0"

inherit core-image

# "weston" in IMAGE_FEATURES switches SYSTEMD_DEFAULT_TARGET to graphical.target
# (without it the image stays on multi-user and the kiosk never starts).
IMAGE_FEATURES += " \
    ssh-server-openssh \
    package-management \
    weston \
"

IMAGE_INSTALL += " \
    packagegroup-core-boot \
    kernel-modules \
    weston \
    weston-init \
    chromium-bin \
    nginx \
    python3 \
    ca-certificates \
    blackhole-shell \
    blackholed \
    blackhole-session \
    blackhole-extensions \
    rauc \
    networkmanager \
    networkmanager-nmcli \
    bluez5 \
    mesa-megadriver \
    tzdata \
    systemd-timesyncd \
"

# Raspberry Pi onboard CYW43xx Wi-Fi / Bluetooth (UART attach + firmware).
IMAGE_INSTALL:append:rpi = " \
    pi-bluetooth \
    linux-firmware-rpidistro-bcm43430 \
    linux-firmware-rpidistro-bcm43455 \
    linux-firmware-rpidistro-bcm43436 \
    linux-firmware-rpidistro-bcm43436s \
    linux-firmware-rpidistro-bcm43456 \
    v4l-utils \
    libv4l \
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
