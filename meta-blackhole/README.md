# meta-blackhole

Yocto / OpenEmbedded layer for **Blackhole OS**.

## Contents

- Distro: `blackhole` (`conf/distro/blackhole.conf`)
- Image: `blackhole-image`
- Bundle: `blackhole-bundle` (RAUC)
- Session: Weston + Chromium kiosk + nginx shell + `blackholed`
- WKS: dual A/B rootfs + `bhdata` partition

## Build

From the repository root, with [kas](https://kas.readthedocs.io/):

```bash
kas build kas/raspberrypi4-64.yml
kas build kas/raspberrypi5.yml
kas build kas/genericx86-64.yml
```

Before a release image, build the shell and copy it into the recipe:

```bash
cd apps/shell && npm ci && npm run build
rm -rf ../../meta-blackhole/recipes-core/blackhole-shell/files/shell-out
cp -R out ../../meta-blackhole/recipes-core/blackhole-shell/files/shell-out
```

Development RAUC keys live under `recipes-core/rauc/files/`. Replace them for
production signing.
