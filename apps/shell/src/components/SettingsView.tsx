"use client";

import { useEffect, useState } from "react";
import {
  api,
  type DeviceSettings,
  type NetworkStatus,
  type SystemInfo,
  type UpdateStatus,
} from "@/lib/api";

type Section = "about" | "network" | "display" | "adblock" | "updates";

type FocusableProps = {
  focusKey: string;
  className?: string;
  onEnterPress?: () => void;
  onFocus?: () => void;
  children: React.ReactNode;
  as?: "button" | "div";
  [key: string]: unknown;
};

type Props = {
  Focusable: (props: FocusableProps) => React.ReactElement;
  system: SystemInfo | null;
  update: UpdateStatus | null;
  onUpdateChange: (next: UpdateStatus) => void;
  onSystemChange: (next: SystemInfo) => void;
  showToast: (message: string, kind?: "info" | "error") => void;
};

const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "about", label: "About", blurb: "Version and machine" },
  { id: "network", label: "Network", blurb: "Wi-Fi for this TV" },
  { id: "display", label: "Display", blurb: "Scale and motion" },
  { id: "adblock", label: "Ad block", blurb: "uBlock Origin" },
  { id: "updates", label: "Updates", blurb: "RAUC OTA channel" },
];

function applyDisplay(display: DeviceSettings["display"]) {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(display.scale / 100));
  root.dataset.reducedMotion = display.reducedMotion ? "true" : "false";
}

export default function SettingsView({
  Focusable,
  system,
  update,
  onUpdateChange,
  onSystemChange,
  showToast,
}: Props) {
  const [section, setSection] = useState<Section>("about");
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsRes, networkRes] = await Promise.all([
          api.settings(),
          api.network(),
        ]);
        setSettings(settingsRes.settings);
        setNetwork(networkRes.network);
        setSsid(settingsRes.settings.network.ssid || "");
        setChannelUrl(settingsRes.settings.channelUrl || "");
        applyDisplay(settingsRes.settings.display);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Settings unavailable", "error");
      }
    })();
  }, [showToast]);

  const saveDisplay = async (patch: Partial<DeviceSettings["display"]>) => {
    if (!settings) return;
    const display = { ...settings.display, ...patch };
      try {
      const res = await api.saveSettings({ display });
      setSettings(res.settings);
      applyDisplay(res.settings.display);
      if (system) {
        onSystemChange({
          ...system,
          display: res.settings.display,
        });
      }
      showToast("Display saved");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save display", "error");
    }
  };

  const connectWifi = async () => {
    const nextSsid = ssid.trim();
    if (!nextSsid) {
      showToast("Enter a network name", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.connectWifi(nextSsid, password);
      setNetwork(res.network);
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              network: res.settings,
            }
          : prev,
      );
      setPassword("");
      showToast(res.message);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Wi-Fi failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveChannel = async () => {
    const url = channelUrl.trim();
    if (!url) {
      showToast("Enter a channel URL", "error");
      return;
    }
    try {
      const res = await api.saveSettings({ channelUrl: url });
      setSettings(res.settings);
      showToast("Channel saved");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save channel", "error");
    }
  };

  const checkForUpdates = async () => {
    setBusy(true);
    try {
      if (channelUrl.trim()) {
        await api.saveSettings({ channelUrl: channelUrl.trim() });
      }
      const status = await api.checkUpdate(channelUrl.trim() || undefined);
      onUpdateChange(status);
      showToast(status.message);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Check failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const installFromChannel = async () => {
    setBusy(true);
    try {
      const res = await api.installUpdate({
        fromChannel: true,
        channelUrl: channelUrl.trim() || undefined,
      });
      showToast(res.message);
      onUpdateChange(await api.update());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Install failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const installManual = async () => {
    const value = manualSource.trim();
    if (!value) {
      showToast("Enter a path or HTTPS URL", "error");
      return;
    }
    setBusy(true);
    try {
      const payload = value.startsWith("http://") || value.startsWith("https://")
        ? { bundleUrl: value }
        : { bundlePath: value };
      const res = await api.installUpdate(payload);
      showToast(res.message);
      onUpdateChange(await api.update());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Install failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const scale = settings?.display.scale ?? 100;
  const reducedMotion = settings?.display.reducedMotion ?? false;

  return (
    <section className="settings-view">
      <div>
        <h2 className="view-title">Settings</h2>
        <p className="view-lede">Network, display, blockers, and OTA for this TV.</p>
      </div>

      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <Focusable
              key={item.id}
              focusKey={`SET_NAV_${item.id.toUpperCase()}`}
              className="settings-nav-item"
              data-active={section === item.id ? "true" : "false"}
              onEnterPress={() => setSection(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.blurb}</span>
            </Focusable>
          ))}
        </div>

        <div className="settings-detail panel" role="tabpanel">
          {section === "about" && (
            <>
              <h3 className="panel-title">About</h3>
              <dl className="settings-facts">
                <div>
                  <dt>System</dt>
                  <dd>{system?.name ?? "Blackhole OS"}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{system?.version ?? "…"}</dd>
                </div>
                <div>
                  <dt>Machine</dt>
                  <dd>{system?.machine ?? "…"}</dd>
                </div>
                <div>
                  <dt>Data</dt>
                  <dd className="mono">{system?.dataDir ?? "…"}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{system?.dev ? "Desktop development" : "Device image"}</dd>
                </div>
              </dl>
            </>
          )}

          {section === "network" && (
            <>
              <h3 className="panel-title">Network</h3>
              <p className="panel-copy">
                {network?.connected
                  ? `Connected to ${network.ssid ?? "Wi-Fi"}`
                  : network?.message || "Not connected"}
                {network?.signal ? ` · signal ${network.signal}` : ""}
              </p>
              <div className="settings-stack">
                <label className="field-label" htmlFor="wifi-ssid">
                  Network name
                </label>
                <Focusable
                  as="div"
                  focusKey="SET_WIFI_SSID"
                  className="store-field store-field-bare"
                  onEnterPress={() => {
                    document.getElementById("wifi-ssid")?.focus();
                  }}
                >
                  <input
                    id="wifi-ssid"
                    value={ssid}
                    onChange={(e) => setSsid(e.target.value)}
                    placeholder="Home Wi-Fi"
                    autoComplete="off"
                  />
                </Focusable>
                <label className="field-label" htmlFor="wifi-pass">
                  Password
                </label>
                <Focusable
                  as="div"
                  focusKey="SET_WIFI_PASS"
                  className="store-field store-field-bare"
                  onEnterPress={() => {
                    document.getElementById("wifi-pass")?.focus();
                  }}
                >
                  <input
                    id="wifi-pass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Optional on open networks"
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void connectWifi();
                      }
                    }}
                  />
                </Focusable>
                <Focusable
                  focusKey="SET_WIFI_SAVE"
                  className="primary-btn"
                  onEnterPress={() => void connectWifi()}
                >
                  {busy ? "Working…" : "Save and connect"}
                </Focusable>
              </div>
            </>
          )}

          {section === "display" && (
            <>
              <h3 className="panel-title">Display</h3>
              <p className="panel-copy">UI scale for sitting farther from the TV.</p>
              <div className="choice-row" role="group" aria-label="UI scale">
                {[100, 125, 150].map((value) => (
                  <Focusable
                    key={value}
                    focusKey={`SET_SCALE_${value}`}
                    className="choice-chip"
                    data-active={scale === value ? "true" : "false"}
                    onEnterPress={() => void saveDisplay({ scale: value })}
                  >
                    {value}%
                  </Focusable>
                ))}
              </div>
              <Focusable
                focusKey="SET_MOTION"
                className="choice-chip choice-chip-wide"
                data-active={reducedMotion ? "true" : "false"}
                onEnterPress={() => void saveDisplay({ reducedMotion: !reducedMotion })}
              >
                {reducedMotion ? "Reduced motion on" : "Reduced motion off"}
              </Focusable>
            </>
          )}

          {section === "adblock" && (
            <>
              <h3 className="panel-title">Ad block</h3>
              <p className={system?.ublock.enabled ? "status-ok" : "status-fault"}>
                {system?.ublock.enabled
                  ? "uBlock Origin is enabled in the Chromium kiosk"
                  : "uBlock Origin was not detected"}
              </p>
              <p className="panel-copy">
                {system?.ublock.note ||
                  "Loaded with --load-extension on every kiosk start."}
              </p>
              <p className="panel-copy">
                Full uBlock Origin (Manifest V2) ships with the image. Filter lists
                update when the TV is online.
              </p>
            </>
          )}

          {section === "updates" && (
            <>
              <h3 className="panel-title">Updates</h3>
              <dl className="settings-facts">
                <div>
                  <dt>Running</dt>
                  <dd>{update?.version ?? system?.version ?? "…"}</dd>
                </div>
                <div>
                  <dt>Slot</dt>
                  <dd className="status-ok">{update?.slot ?? "…"}</dd>
                </div>
                <div>
                  <dt>RAUC</dt>
                  <dd>{update?.available ? "Ready" : update?.message ?? "…"}</dd>
                </div>
                {update?.remote ? (
                  <div>
                    <dt>Channel</dt>
                    <dd>
                      {update.remote.version}
                      {update.remote.newer ? " · update available" : " · current"}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {update?.remote?.notes ? (
                <p className="panel-copy">{update.remote.notes}</p>
              ) : null}

              <div className="settings-stack">
                <label className="field-label" htmlFor="channel-url">
                  Channel URL (GitHub or AWS)
                </label>
                <Focusable
                  as="div"
                  focusKey="SET_CHANNEL"
                  className="store-field store-field-bare"
                  onEnterPress={() => {
                    document.getElementById("channel-url")?.focus();
                  }}
                >
                  <input
                    id="channel-url"
                    value={channelUrl}
                    onChange={(e) => setChannelUrl(e.target.value)}
                    placeholder="https://…/channel.json"
                    aria-label="OTA channel URL"
                  />
                </Focusable>
                <div className="button-row">
                  <Focusable
                    focusKey="SET_CHANNEL_SAVE"
                    className="pager-btn"
                    onEnterPress={() => void saveChannel()}
                  >
                    Save channel
                  </Focusable>
                  <Focusable
                    focusKey="SET_CHECK"
                    className="primary-btn"
                    onEnterPress={() => void checkForUpdates()}
                  >
                    {busy ? "Checking…" : "Check for updates"}
                  </Focusable>
                  <Focusable
                    focusKey="SET_INSTALL_CHANNEL"
                    className="primary-btn"
                    onEnterPress={() => void installFromChannel()}
                  >
                    Install from channel
                  </Focusable>
                </div>

                <label className="field-label" htmlFor="bundle-source">
                  Or install a path / direct .raucb URL
                </label>
                <div className="url-form">
                  <Focusable
                    as="div"
                    focusKey="SET_BUNDLE"
                    className="store-field store-field-bare"
                    onEnterPress={() => {
                      document.getElementById("bundle-source")?.focus();
                    }}
                  >
                    <input
                      id="bundle-source"
                      value={manualSource}
                      onChange={(e) => setManualSource(e.target.value)}
                      placeholder="/media/usb/bundle.raucb or https://…/bundle.raucb"
                      aria-label="Bundle path or URL"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void installManual();
                        }
                      }}
                    />
                  </Focusable>
                  <Focusable
                    focusKey="SET_UPDATE"
                    className="primary-btn"
                    onEnterPress={() => void installManual()}
                  >
                    Update now
                  </Focusable>
                </div>
                <p className="panel-copy">
                  Host <code>channel.json</code> + your <code>.raucb</code> on GitHub
                  Releases or S3/CloudFront. See docs/OTA.md.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
