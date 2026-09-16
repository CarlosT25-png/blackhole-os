#!/bin/sh
# Run ON the Pi (as root). Installs Chrome ATK/X11/GLib libs into /opt/chromium/lib.
# Usage:
#   wget -O- http://<mac-ip>:8000/install-chrome-libs-on-device.sh | sh
# Or copy this file to the Pi and: sh install-chrome-libs-on-device.sh
set -eu

LIBDIR=/opt/chromium/lib
mkdir -p "$LIBDIR"
cd /tmp
rm -rf bh-chrome-libs
mkdir bh-chrome-libs
cd bh-chrome-libs

# Prefer a prebuilt tarball if CHROME_LIBS_URL is set (fast path from your Mac).
if [ -n "${CHROME_LIBS_URL:-}" ]; then
  echo "Downloading $CHROME_LIBS_URL …"
  wget -O libs.tar.gz "$CHROME_LIBS_URL"
  tar -xzf libs.tar.gz -C "$LIBDIR"
else
  echo "Downloading Ubuntu arm64 packages…"
  # Ports mirror — works when the Pi has internet.
  BASE=http://ports.ubuntu.com/ubuntu-ports/pool/main
  # shellcheck disable=SC2086
  set -- \
    "$BASE/a/at-spi2-core/libatspi2.0-0t64_2.52.0-1build1_arm64.deb" \
    "$BASE/a/at-spi2-atk/libatk-bridge2.0-0t64_2.52.0-1build1_arm64.deb" \
    "$BASE/a/atk1.0/libatk1.0-0t64_2.52.0-1build1_arm64.deb" \
    "$BASE/libx/libx11/libx11-6_1.8.7-1build1_arm64.deb" \
    "$BASE/libx/libx11/libx11-xcb1_1.8.7-1build1_arm64.deb" \
    "$BASE/libx/libxext/libxext6_1.3.4-1build2_arm64.deb" \
    "$BASE/libx/libxcomposite/libxcomposite1_0.4.5-1build3_arm64.deb" \
    "$BASE/libx/libxdamage/libxdamage1_1.1.6-1build1_arm64.deb" \
    "$BASE/libx/libxfixes/libxfixes3_6.0.0-2build1_arm64.deb" \
    "$BASE/libx/libxrandr/libxrandr2_1.5.2-2build1_arm64.deb" \
    "$BASE/libx/libxcb/libxcb1_1.15-1ubuntu2_arm64.deb" \
    "$BASE/libx/libxau/libxau6_1.0.9-1build6_arm64.deb" \
    "$BASE/libx/libxdmcp/libxdmcp6_1.1.3-0ubuntu6_arm64.deb" \
    "$BASE/libx/libxi/libxi6_1.8.1-1build1_arm64.deb" \
    "$BASE/libx/libxrender/libxrender1_0.9.10-1.1build1_arm64.deb" \
    "$BASE/libx/libxtst/libxtst6_1.2.3-1.1build1_arm64.deb" \
    "$BASE/e/epoxy/libepoxy0_1.5.10-1build1_arm64.deb" \
    "$BASE/libb/libbsd/libbsd0_0.12.1-1build1.1_arm64.deb" \
    "$BASE/libm/libmd/libmd0_1.1.0-2build1.1_arm64.deb" \
    "$BASE/g/glib2.0/libglib2.0-0t64_2.80.0-6ubuntu3.8_arm64.deb" \
    "$BASE/libf/libffi/libffi8_3.4.6-1build1_arm64.deb" \
    "$BASE/p/pcre2/libpcre2-8-0_10.42-4ubuntu2.1_arm64.deb" \
    "$BASE/u/util-linux/libmount1_2.39.3-9ubuntu6.6_arm64.deb" \
    "$BASE/u/util-linux/libblkid1_2.39.3-9ubuntu6.6_arm64.deb" \
    "$BASE/libs/libselinux/libselinux1_3.5-2ubuntu2.1_arm64.deb" \
    "$BASE/z/zlib/zlib1g_1.3.dfsg-3.1ubuntu2.2_arm64.deb"

  for url in "$@"; do
    wget -q "$url" || wget -q "${url/t64/}" || echo "skip $url"
  done

  mkdir root
  for deb in *.deb; do
    [ -f "$deb" ] || continue
    dpkg-deb -x "$deb" root
  done
  find root -type f -name '*.so*' -exec cp -a {} "$LIBDIR/" \;
  # SONAME symlinks for versioned libs
  cd "$LIBDIR"
  ln -sf libatk-1.0.so.0.* libatk-1.0.so.0 2>/dev/null || true
  ln -sf libatk-bridge-2.0.so.0.* libatk-bridge-2.0.so.0 2>/dev/null || true
  ln -sf libatspi.so.0.* libatspi.so.0 2>/dev/null || true
  ln -sf libX11.so.6.* libX11.so.6 2>/dev/null || true
  ln -sf libX11-xcb.so.1.* libX11-xcb.so.1 2>/dev/null || true
  ln -sf libXext.so.6.* libXext.so.6 2>/dev/null || true
  ln -sf libXcomposite.so.1.* libXcomposite.so.1 2>/dev/null || true
  ln -sf libXdamage.so.1.* libXdamage.so.1 2>/dev/null || true
  ln -sf libXfixes.so.3.* libXfixes.so.3 2>/dev/null || true
  ln -sf libXrandr.so.2.* libXrandr.so.2 2>/dev/null || true
  ln -sf libxcb.so.1.* libxcb.so.1 2>/dev/null || true
  ln -sf libXau.so.6.* libXau.so.6 2>/dev/null || true
  ln -sf libXdmcp.so.6.* libXdmcp.so.6 2>/dev/null || true
  ln -sf libXi.so.6.* libXi.so.6 2>/dev/null || true
  ln -sf libXrender.so.1.* libXrender.so.1 2>/dev/null || true
  ln -sf libXtst.so.6.* libXtst.so.6 2>/dev/null || true
  ln -sf libepoxy.so.0.* libepoxy.so.0 2>/dev/null || true
  ln -sf libbsd.so.0.* libbsd.so.0 2>/dev/null || true
  ln -sf libmd.so.0.* libmd.so.0 2>/dev/null || true
  ln -sf libglib-2.0.so.0.* libglib-2.0.so.0 2>/dev/null || true
  ln -sf libgobject-2.0.so.0.* libgobject-2.0.so.0 2>/dev/null || true
  ln -sf libgio-2.0.so.0.* libgio-2.0.so.0 2>/dev/null || true
  ln -sf libgmodule-2.0.so.0.* libgmodule-2.0.so.0 2>/dev/null || true
  ln -sf libgthread-2.0.so.0.* libgthread-2.0.so.0 2>/dev/null || true
  ln -sf libffi.so.8.* libffi.so.8 2>/dev/null || true
  ln -sf libpcre2-8.so.0.* libpcre2-8.so.0 2>/dev/null || true
  ln -sf libmount.so.1.* libmount.so.1 2>/dev/null || true
  ln -sf libblkid.so.1.* libblkid.so.1 2>/dev/null || true
  ln -sf libz.so.1.* libz.so.1 2>/dev/null || true
fi

cat > /usr/bin/chromium-bin << 'EOF'
#!/bin/sh
export CHROME_WRAPPER="$(readlink -f "$0")"
export LD_LIBRARY_PATH="/opt/chromium/lib:/opt/chromium${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec /opt/chromium/chrome --no-sandbox "$@"
EOF
chmod 755 /usr/bin/chromium-bin

mkdir -p /etc/systemd/system/blackhole-kiosk.service.d
cat > /etc/systemd/system/blackhole-kiosk.service.d/wayland.conf << 'EOF'
[Service]
Environment=XDG_RUNTIME_DIR=/run
Environment=WAYLAND_DISPLAY=wayland-0
Environment=LD_LIBRARY_PATH=/opt/chromium/lib:/opt/chromium
EOF

systemctl daemon-reload
systemctl restart blackhole-kiosk || true
echo "Done. libs in $LIBDIR — check: systemctl status blackhole-kiosk --no-pager -l"
