# Override meta-rauc-raspberrypi fstab (expects p5=/data p6=/home).
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

dirs755 += "/var/lib/blackhole"
