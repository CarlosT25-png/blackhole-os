# Blackhole OS

A living-room TV operating system for Raspberry Pi 4 Model B, Raspberry Pi 5,
and generic x86_64 PCs. The image boots into Chromium with **uBlock Origin Lite**,
serving a Next.js kiosk shell (home, store, settings). Apps are Progressive Web
Apps. System updates use **RAUC** A/B slots.

## Architecture

```
Wayland kiosk compositor
  └─ Chromium (--kiosk, uBlock Origin Lite, kiosk-bridge)
       ├─ Shell @ http://127.0.0.1  (nginx → Next.js static export)
       └─ blackholed @ :8081       (apps, launch, RAUC)
```

Installed apps live on a persistent data partition so they survive OTA updates.
The store catalog and shell UI are hosted on Vercel and cached locally for offline use.

## Repository layout

| Path | Purpose |
|------|---------|
| `apps/shell` | Next.js 10-foot kiosk UI (`output: 'export'`) |
| `apps/shell/public/catalog/apps.json` | Store catalog served by the hosted shell |
| `services/blackholed` | Local Python API for apps and updates |
| `catalog/apps.json` | Canonical curated PWA store catalog |
| `extensions/kiosk-bridge` | Chromium extension: Home/Back → shell |
| `meta-blackhole` | Yocto distro, image, RAUC, systemd units |
| `kas/` | Reproducible image builds |
| `scripts/dev-kiosk.sh` | Desktop Chromium kiosk for daily development |
| `scripts/sync-catalog.sh` | Copy catalog into shell public + Yocto recipe |
| `scripts/build-shell-manifest.sh` | Write `shell-manifest.json` after Next export |

## App store catalog (online + offline)

Edit **`catalog/apps.json`**, then sync and deploy the shell:

```bash
./scripts/sync-catalog.sh
# deploy apps/shell to https://blackhole-os-panel.carlostorres.dev
# catalog is served at /catalog/apps.json
```

`blackholed` keeps a local offline copy at `data/catalog.json` (on device:
`/var/lib/blackhole/catalog.json`). On startup and each `GET /catalog` it fetches
`catalogUrl`, compares a content hash, and updates the local file only when the
remote list differs. Offline Store + installs use the local cache.

Default `catalogUrl` is
`https://blackhole-os-panel.carlostorres.dev/catalog/apps.json`.
Change it under **Settings → Updates**, or set `BLACKHOLE_CATALOG_URL`.
Offline devices keep using the bundled/`data/catalog.json` cache until they
can reach that host.

Installed apps remain separate in `data/apps.json` and are not overwritten by
catalog sync.

## Shell UI sync (Vercel → local overlay)

Deploying the panel updates the **on-device shell UI** without a full OS OTA and
without touching installed PWAs.

```bash
cd apps/shell
npm run build   # also writes out/shell-manifest.json
# deploy out/ (or the Vercel project) to https://blackhole-os-panel.carlostorres.dev
```

On the TV, nginx serves `/var/lib/blackhole/shell` (seeded once from the image).
`blackholed` fetches `{shellUrl}/shell-manifest.json`, and when `version` changes
downloads each file into that overlay. Offline boots keep the last synced UI.

- Default panel URL: `https://blackhole-os-panel.carlostorres.dev`
- Settings → Updates → **Check for shell update**, or `POST /shell/sync`
- Env: `BLACKHOLE_SHELL_UPDATE_URL`

Chromium still opens `http://127.0.0.1/` (local), not Vercel, so the UI works offline.

## Desktop development (recommended daily loop)

You do **not** need a Yocto build machine to work on the UI.

```bash
# Keep public catalog in sync after editing catalog/apps.json
./scripts/sync-catalog.sh

# Terminal 1 — API (Python 3 stdlib only; no pip needed)
cd services/blackholed
python3 blackholed.py

# Terminal 2 — shell
cd apps/shell
npm install
npm run dev

# Terminal 3 — Chromium kiosk (optional)
./scripts/dev-kiosk.sh
```

Open http://127.0.0.1:3000 for the shell. Arrow keys + Enter navigate.

`./scripts/dev-kiosk.sh` uses **Chrome for Testing** (not branded Google Chrome),
because Chrome 137+ ignores `--load-extension`. On first run it may download
that browser. In the kiosk, Esc / the top-right **Blackhole** chip return home;
confirm extensions at `chrome://extensions`.

## Building images with Yocto (kas)

Requirements: ~16 GB RAM, tens of GB disk, Docker or a Linux host with
[kas](https://kas.readthedocs.io/). Chromium builds take hours.

```bash
# Raspberry Pi 4 Model B (64-bit)
kas build kas/raspberrypi4-64.yml

# Raspberry Pi 5
kas build kas/raspberrypi5.yml

# Generic x86_64 (PC / QEMU)
kas build kas/genericx86-64.yml
```

Flash the resulting `.wic` / `.wic.bmap` with `bmaptool` or `dd`.

### OTA with RAUC

See **[docs/OTA.md](docs/OTA.md)** for the full flow (GitHub Releases and AWS S3).

```bash
# On the build host
bitbake blackhole-bundle

# Publish channel.json + .raucb to GitHub Releases or S3, then on the TV:
# Settings → Updates → set channel URL → Check for updates → Install from channel
```

Short version: host a `channel.json` that points at your `.raucb`. The TV downloads
it, `rauc install`s into the inactive slot, then reboot activates it.

## Machines

| MACHINE | Hardware |
|---------|----------|
| `raspberrypi4-64` | Raspberry Pi 4 Model B |
| `raspberrypi5` | Raspberry Pi 5 |
| `genericx86-64` | 64-bit PC / QEMU |

Yocto release: **Scarthgap 5.0 LTS**.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
