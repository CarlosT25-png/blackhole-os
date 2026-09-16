# AGENTS.md

Guidance for AI agents working on **Blackhole OS**.

## Overview

Blackhole OS is a living-room TV operating system for Raspberry Pi 4/5 and generic x86_64. It boots into a Wayland kiosk (Weston + Chromium) with **uBlock Origin Lite** and a **kiosk-bridge** extension, serving a Next.js 10-foot UI (home / store / settings). “Apps” are Progressive Web Apps. System updates use **RAUC** A/B slots; installed apps and Chromium profile live on a persistent `bhdata` partition.

The curated store catalog and shell UI can be hosted on Vercel (`https://blackhole-os-panel.carlostorres.dev`) and synced locally for offline use. Installed PWAs (`apps.json`) are never overwritten by catalog or shell sync.

## Tech Stack

| Layer | Stack |
|-------|--------|
| Shell UI | Next.js 15 (`output: 'export'`), React 19, TypeScript, `@noriginmedia/norigin-spatial-navigation` |
| Local API | Python 3 **stdlib only** (`http.server`, `urllib`, `json`, …) — no pip runtime deps |
| Browser | Chromium (`chromium-bin` / Chrome for Testing) + uBlock Origin Lite + `extensions/kiosk-bridge` |
| Compositor | Weston / Wayland |
| Web server | nginx serving static shell overlay |
| Image build | Yocto **Scarthgap 5.0 LTS**, [kas](https://kas.readthedocs.io/), custom layer `meta-blackhole` |
| OTA | RAUC A/B + `channel.json` |
| Panel hosting | Vercel (static export + `catalog/apps.json` + `shell-manifest.json`) |

## Project Structure

```
blackhole-os/
├── apps/shell/                 # Next.js kiosk UI (static export)
│   ├── public/catalog/         # Synced copy of store catalog for hosting
│   └── src/
│       ├── app/                # App Router pages / layout / CSS
│       ├── components/         # Shell.tsx, SettingsView.tsx
│       └── lib/                # api.ts, display.ts
├── catalog/apps.json           # Canonical curated PWA catalog
├── services/blackholed/        # Local daemon (source of truth for API)
├── extensions/kiosk-bridge/    # Chromium: Home/Back → shell
├── extensions/ublock/          # Downloaded locally (gitignored)
├── meta-blackhole/             # Yocto layer (mirrors recipes + baked shell)
│   ├── recipes-core/           # image, shell, blackholed, session, rauc, bundles, fstab
│   ├── recipes-browser/        # chromium-bin + extensions packaging
│   ├── recipes-graphics/       # Weston kiosk-shell
│   └── wic/                    # dual-slot + bhdata partition layouts
├── kas/                        # Machine-specific kas configs
├── scripts/                    # Dev kiosk, catalog/shell sync helpers
├── docs/                       # OTA + channel.example.json
└── data/                       # Local/dev persistent state (gitignored)
```

**Mirrored copies:** edit `services/blackholed/blackholed.py` and `extensions/kiosk-bridge/` as source, then copy into `meta-blackhole/recipes-*/files/` when packaging. Shell export is synced via `scripts/sync-shell-to-recipe.sh`.

## Architecture & Patterns

```
Wayland (Weston)
  └─ Chromium --kiosk
       ├─ Shell @ http://127.0.0.1/     nginx → /var/lib/blackhole/shell
       └─ blackholed @ :8081           apps, catalog, settings, Wi-Fi, BT, time, power, RAUC, shell sync
```

### Data on device (`/var/lib/blackhole` or `./data` in dev)

| File / dir | Role |
|------------|------|
| `apps.json` | Installed PWAs only |
| `catalog.json` | Offline store catalog cache |
| `shell/` | Synced shell UI overlay (nginx root) |
| `shell-version.json` | Last synced shell manifest version |
| `settings.json` | channelUrl, catalogUrl, shellUrl, display (scale/aspect/refreshHz), adblock, network, time (timezone/ntp/autoTimezone/hour12), power (idleSec) |
| `weston.ini` | Generated display mode / refresh under data dir (image) |
| `launch.json` | Pending navigate target for kiosk-bridge |
| `chromium/` | Browser profile |

### Shell → API

- Browser calls `NEXT_PUBLIC_API_BASE` or default `http://127.0.0.1:8081`.
- Spatial navigation focus keys drive TV remote UX (`Shell.tsx`, `SettingsView.tsx`).

### blackholed routes (representative)

- `GET /catalog`, `GET|POST|DELETE /apps`, `POST /apps/order`, `POST /apps/:id/launch`
- `GET|PUT /settings` (display, adblock, time, power; catalog/shell/channel URLs persist but are not edited in the kiosk UI), `GET /system`, `GET|POST /network`, `GET /network/scan`
- `GET|POST /time` (timezone, NTP, manual clock), `GET|POST /power` (sleep/wake/poweroff/activity)
- `GET|POST /bluetooth` (pair with optional PIN), `GET /update`, `POST /update/check`, `POST /update`
- `POST /shell/sync`, `GET /launch`, `POST /launch/ack`, `GET /health`

### Sync patterns

1. **Catalog:** fetch `catalogUrl` → hash compare → write `catalog.json` if changed; else keep local. Seed from bundled `/etc/blackhole/catalog.json` or repo `catalog/apps.json`.
2. **Shell UI:** fetch `{shellUrl}/shell-manifest.json` → if version differs, download hashed files into staging → atomic swap of `shell/` overlay. Never touches `apps.json`.
3. **RAUC OTA:** separate channel (`channel.json` + `.raucb`); persists apps via `bhdata` partition.

### Image boot path

1. Mount `bhdata` → `/var/lib/blackhole`
2. `blackholed` seeds shell overlay from `/usr/share/blackhole/shell` if needed, best-effort remote sync
3. nginx roots at `/var/lib/blackhole/shell`
4. Chromium kiosk opens `BLACKHOLE_SHELL_URL` (default `http://127.0.0.1/`)

## Commands

```bash
# Catalog → shell public + Yocto recipe copy
./scripts/sync-catalog.sh

# Shell: install / dev / production export (+ shell-manifest.json)
cd apps/shell && npm install && npm run dev
cd apps/shell && npm run build

# Local API
cd services/blackholed && python3 blackholed.py

# Desktop Chromium kiosk (Chrome for Testing + extensions; do not sudo)
./scripts/dev-kiosk.sh

# Bake static shell into meta-blackhole recipe
./scripts/sync-shell-to-recipe.sh

# Yocto images
kas build kas/raspberrypi4-64.yml
kas build kas/raspberrypi5.yml
kas build kas/genericx86-64.yml

# RAUC bundle (on build host)
bitbake blackhole-bundle
```

## Code Conventions

- **Python daemon:** single-file stdlib HTTP handler; keep `services/blackholed/blackholed.py` and the Yocto `files/blackholed.py` in sync after API changes.
- **No pip** for on-device blackholed runtime.
- **Shell:** App Router + client components; TV-first CSS in `globals.css`; focusable controls via spatial navigation `focusKey`s.
- **Static export only** (`next.config.ts` `output: 'export'`) — no Next.js API routes on device.
- **Canonical catalog** is `catalog/apps.json`; always run `./scripts/sync-catalog.sh` before deploy/image bake.
- **Do not** store secrets in git; `data/` is gitignored. Devel RAUC keys under `meta-blackhole/.../rauc/files/` are intentional exceptions.
- Kas-cloned layers (`poky/`, `meta-openembedded/`, `meta-raspberrypi/`, `meta-rauc*`, `meta-lts-mixins/`) stay gitignored; only `meta-blackhole/` is in-tree.
- Prefer small, focused changes; mirror packaging files when behavior ships in the image.

## Environment & Deployment

| Variable | Purpose | Typical value |
|----------|---------|----------------|
| `BLACKHOLE_DATA` | Persistent data dir | `./data` or `/var/lib/blackhole` |
| `BLACKHOLE_DEV` | Dev simulations (Wi-Fi, RAUC) | `1` desktop / `0` image |
| `BLACKHOLE_HOST` / `PORT` | API bind | `127.0.0.1` / `8081` |
| `BLACKHOLE_SHELL_URL` | Chromium start URL | `http://127.0.0.1:3000` or `http://127.0.0.1/` |
| `BLACKHOLE_CATALOG` | Bundled catalog seed | `catalog/apps.json` or `/etc/blackhole/catalog.json` |
| `BLACKHOLE_CATALOG_URL` | Remote catalog | `https://blackhole-os-panel.carlostorres.dev/catalog/apps.json` |
| `BLACKHOLE_SHELL_UPDATE_URL` | Panel origin for UI sync | `https://blackhole-os-panel.carlostorres.dev` |
| `BLACKHOLE_BUNDLED_SHELL` | Seed for overlay | `/usr/share/blackhole/shell` |
| `BLACKHOLE_CHANNEL_URL` | RAUC channel.json | `https://github.com/CarlosT25-png/blackhole-os/releases/latest/download/channel.json` |
| `BLACKHOLE_UI_SCALE` | Chromium `--force-device-scale-factor` | `1.0` on image |
| `BLACKHOLE_VERSION` / `MACHINE` | Reported system info | image build |
| `NEXT_PUBLIC_API_BASE` | Shell → API | default `http://127.0.0.1:8081` |

**Panel:** deploy Next static export to Vercel at `blackhole-os-panel.carlostorres.dev` (includes `/catalog/apps.json` and `/shell-manifest.json`).

**Constraints:** Chromium builds are heavy; image builds need large disk/RAM. Chrome 137+ branded builds ignore `--load-extension` — desktop kiosk uses Chrome for Testing (`scripts/dev-kiosk.sh`).

## Current State

### Implemented

- Next.js kiosk shell: home shelf, store, settings (display scale/aspect/Hz, date/time + timezone + NTP, sleep/power off, Wi-Fi/Bluetooth credential popups + spinners, adblock filtering levels, updates without URL fields)
- blackholed: app install/uninstall/reorder/launch, catalog cache sync, shell overlay sync, settings (Weston mode + Chrome/uBOL policies), timezone/NTP, display sleep/idle/wake, poweroff, network, bluetooth PIN pair, RAUC check/install (with desktop simulation)
- Catalog + shell hosting/sync for `blackhole-os-panel.carlostorres.dev`
- kiosk-bridge: Home chip + adblock level chips + PWA page zoom + idle activity pings; uBlock Origin Lite packaging
- Chromium kiosk: password-manager/popup policies, GPU/video decode flags; Pi CMA/overscan; x86 VAAPI packages; mesa megadriver
- Yocto image: `chromium-bin`, dual-slot WKS, nginx shell recipe, blackholed systemd unit + NM timesync dispatcher, session/kiosk, Weston kiosk-shell, RAUC devel keys, kas machine configs
- Pi 4 first boot uses direct kernel (`RPI_USE_U_BOOT=0`); flashable `*-nobootloader.wic` is the supported image
- Docs: README, `docs/OTA.md`, channel example

### Placeholders / incomplete

- Full Yocto image not assumed built/validated on every machine; Chromium/uBlock recipe paths may need checksum/fetch updates (`scripts/fetch-ublock-checksum.sh`)
- Default RAUC `channelUrl` is GitHub Releases (`CarlosT25-png/blackhole-os`); first GitHub Release is a flashable Pi 4 image, not a `.raucb` OTA bundle
- `meta-blackhole/recipes-core/blackhole-shell/files/shell-out/` must be populated via `sync-shell-to-recipe.sh` before release images
- Pi 4 bring-up still skips U-Boot; RAUC A/B via U-Boot is not wired on that machine yet
- Chrome for Testing may still soft-decode video on Pi (V4L2 HW decode not guaranteed without a custom Chromium build)
- Desktop `data/` is local-only; not part of the git repo
- No automated CI/test suite in-repo yet
