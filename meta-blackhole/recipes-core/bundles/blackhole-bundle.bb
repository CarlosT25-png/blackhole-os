SUMMARY = "Blackhole OS RAUC update bundle"
DESCRIPTION = "A/B rootfs bundle for Blackhole OS"
LICENSE = "Apache-2.0"

inherit bundle

RAUC_BUNDLE_COMPATIBLE = "blackhole-os"
RAUC_BUNDLE_VERSION = "${DISTRO_VERSION}"
RAUC_BUNDLE_DESCRIPTION = "Blackhole OS update"
RAUC_BUNDLE_FORMAT = "verity"

RAUC_BUNDLE_SLOTS = "rootfs"
RAUC_SLOT_rootfs = "blackhole-image"
RAUC_SLOT_rootfs[fstype] = "ext4"

RAUC_KEY_FILE = "${THISDIR}/files/devel.key.pem"
RAUC_CERT_FILE = "${THISDIR}/files/devel-ca.cert.pem"
