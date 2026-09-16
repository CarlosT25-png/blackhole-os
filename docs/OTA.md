# OTA updates with RAUC

Blackhole OS uses **RAUC** A/B slots. One rootfs is active; an update writes the
other slot, then a reboot switches boot. Apps and Chromium profile live on the
`bhdata` partition so they survive OTA.

## Flow

```
Build host                 Update host              Device
─────────                  ───────────              ──────
bitbake blackhole-bundle → upload .raucb +          Settings → Check
                           channel.json             download → rauc install
                                                    → reboot into new slot
```

1. Build a signed bundle: `bitbake blackhole-bundle` → `*.raucb`
2. Publish `channel.json` + the `.raucb` (GitHub Releases or S3/CloudFront)
3. On the TV, Settings → Updates → **Check for updates**
4. **Install update** downloads the bundle and runs `rauc install`
5. Reboot to boot the new slot

## channel.json

```json
{
  "compatible": "blackhole-os",
  "version": "0.2.0",
  "bundleUrl": "https://…/blackhole-bundle.raucb",
  "sha256": "<sha256 of the .raucb>",
  "notes": "Optional release notes"
}
```

See [channel.example.json](channel.example.json).

`compatible` must match RAUC `system.conf` (`blackhole-os`). The device compares
`version` to its running `BLACKHOLE_VERSION`.

## Host on GitHub Releases

Good for open-source / small fleets.

1. Create a GitHub Release (e.g. `v0.2.0`)
2. Attach:
   - `blackhole-bundle.raucb`
   - `channel.json` (with `bundleUrl` pointing at the release asset)
3. Stable channel URL:

```text
https://github.com/CarlosT25-png/blackhole-os/releases/latest/download/channel.json
```

Per-version bundle URL:

```text
https://github.com/CarlosT25-png/blackhole-os/releases/download/v0.2.0/blackhole-bundle.raucb
```

Devices already use that latest `channel.json` URL. Attach `channel.json` and the `.raucb` to a GitHub Release; Settings → Updates will pick it up.

**Limits:** public release assets are fine; very large bundles may hit GitHub
asset size limits — then use S3.

## Host on AWS (S3 + CloudFront)

Better for private fleets and large images.

1. Create a bucket, e.g. `blackhole-updates`
2. Upload:

```text
s3://blackhole-updates/channel.json
s3://blackhole-updates/v0.2.0/blackhole-bundle.raucb
```

3. Put CloudFront (or public HTTPS) in front
4. Set channel URL to:

```text
https://updates.example.com/channel.json
```

with `bundleUrl` in that JSON pointing at the HTTPS object URL.

Optional: CloudFront signed URLs or private bucket + device credentials (not
wired in v1 — keep the channel public or on a private network).

## Install without a channel

Settings also accepts:

- A local path: `/media/usb/blackhole-bundle.raucb`
- A direct HTTPS URL to a `.raucb`

## Signing

Bundles are signed with the keys under
`meta-blackhole/recipes-core/rauc/files/`. Replace the **development** CA/key
before shipping devices; the device keyring must trust your release signer.

## Desktop / dev

Without RAUC, **Install update** still downloads (if URL) and simulates
success so you can exercise the Settings UI.
