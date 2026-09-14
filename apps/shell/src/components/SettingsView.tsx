"use client";

import { useEffect, useState } from "react";
import {
  api,
  type BluetoothDevice,
  type BluetoothStatus,
  type DeviceSettings,
  type NetworkStatus,
  type SystemInfo,
  type UpdateStatus,
  type WifiNetwork,
} from "@/lib/api";

type Section = "about" | "network" | "bluetooth" | "display" | "adblock" | "updates";

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
  { id: "bluetooth", label: "Bluetooth", blurb: "Remotes and devices" },
  { id: "display", label: "Display", blurb: "Scale and motion" },
  { id: "adblock", label: "Ad block", blurb: "uBlock Origin" },
  { id: "updates", label: "Updates", blurb: "RAUC OTA channel" },
];

function applyDisplay(display: DeviceSettings["display"]) {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(display.scale / 100));
  root.dataset.reducedMotion = display.reducedMotion ? "true" : "false";
}

function wifiLocked(network: WifiNetwork) {
  const security = network.security.trim();
  return Boolean(security && security !== "--");
}

function btFocusKey(prefix: string, address: string) {
  return `${prefix}_${address.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function deviceMeta(device: BluetoothDevice) {
  if (device.connected) return "Connected";
  if (device.paired) return "Paired";
  return "Nearby";
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
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanMessage, setScanMessage] = useState("");
  const [selectedSsid, setSelectedSsid] = useState("");
  const [joinOther, setJoinOther] = useState(false);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [scanning, setScanning] = useState(false);
  const [bluetooth, setBluetooth] = useState<BluetoothStatus | null>(null);
  const [btSelected, setBtSelected] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [catalogUrl, setCatalogUrl] = useState("");
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
        setSelectedSsid(settingsRes.settings.network.ssid || "");
        setChannelUrl(settingsRes.settings.channelUrl || "");
        setCatalogUrl(settingsRes.settings.catalogUrl || "");
        applyDisplay(settingsRes.settings.display);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Settings unavailable", "error");
      }
    })();
  }, [showToast]);

  const refreshWifi = async () => {
    setScanning(true);
    try {
      const res = await api.scanWifi();
      setNetworks(res.networks || []);
      setNetwork(res.network);
      setScanMessage(res.message || "");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Wi-Fi scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const refreshBluetooth = async () => {
    try {
      const res = await api.bluetooth();
      setBluetooth(res.bluetooth);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bluetooth unavailable", "error");
    }
  };

  useEffect(() => {
    if (section !== "network") return;
    void refreshWifi();
  }, [section]);

  useEffect(() => {
    if (section !== "bluetooth") return;
    void refreshBluetooth();
  }, [section]);

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

  const connectWifi = async (nextSsid = ssid.trim(), nextPassword = password) => {
    if (!nextSsid) {
      showToast("Enter a network name", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.connectWifi(nextSsid, nextPassword);
      setNetwork(res.network);
      setSsid(nextSsid);
      setSelectedSsid(nextSsid);
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
      await refreshWifi();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Wi-Fi failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const selectWifi = (item: WifiNetwork) => {
    setJoinOther(false);
    setSelectedSsid(item.ssid);
    setSsid(item.ssid);
    if (item.inUse) {
      return;
    }
    if (!wifiLocked(item)) {
      setPassword("");
      void connectWifi(item.ssid, "");
      return;
    }
    setPassword("");
  };

  const runBluetooth = async (
    action: "power" | "scan" | "pair" | "connect" | "disconnect" | "remove",
    extra?: { address?: string; powered?: boolean },
  ) => {
    setBusy(true);
    try {
      const res = await api.bluetoothAction(action, extra);
      setBluetooth(res.bluetooth);
      showToast(res.message);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bluetooth failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const activateBluetoothDevice = (device: BluetoothDevice) => {
    setBtSelected(device.address);
    if (device.connected) {
      void runBluetooth("disconnect", { address: device.address });
      return;
    }
    if (device.paired) {
      void runBluetooth("connect", { address: device.address });
      return;
    }
    void runBluetooth("pair", { address: device.address });
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

  const saveCatalog = async () => {
    const url = catalogUrl.trim();
    if (!url) {
      showToast("Enter a catalog URL", "error");
      return;
    }
    try {
      const res = await api.saveSettings({ catalogUrl: url });
      setSettings(res.settings);
      setCatalogUrl(res.settings.catalogUrl || url);
      showToast("Catalog URL saved");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save catalog URL", "error");
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
  const selectedNetwork = networks.find((item) => item.ssid === selectedSsid);
  const showWifiPassword = joinOther || Boolean(selectedNetwork && wifiLocked(selectedNetwork) && !selectedNetwork.inUse);
  const pairedDevices = bluetooth?.devices.filter((item) => item.paired) ?? [];
  const nearbyDevices =
    bluetooth?.devices.filter((item) => !item.paired && bluetooth.powered) ?? [];

  return (
    <section className="settings-view">
      <div>
        <h2 className="view-title">Settings</h2>
        <p className="view-lede">Network, Bluetooth, display, blockers, and OTA for this TV.</p>
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
              <div className="button-row">
                <Focusable
                  focusKey="SET_WIFI_SCAN"
                  className="primary-btn"
                  onEnterPress={() => void refreshWifi()}
                >
                  {scanning ? "Scanning…" : "Scan"}
                </Focusable>
                <Focusable
                  focusKey="SET_WIFI_OTHER"
                  className="choice-chip"
                  data-active={joinOther ? "true" : "false"}
                  onEnterPress={() => {
                    setJoinOther((prev) => !prev);
                    if (!joinOther) {
                      setSelectedSsid("");
                    }
                  }}
                >
                  Join other network
                </Focusable>
              </div>
              {scanMessage ? <p className="panel-copy">{scanMessage}</p> : null}
              <div className="settings-list" role="list">
                {networks.length === 0 && !scanning ? (
                  <p className="panel-copy">
                    No networks found. Scan again, or join another network.
                  </p>
                ) : (
                  networks.map((item, index) => (
                    <Focusable
                      key={`${item.ssid}-${item.bssid || index}`}
                      focusKey={`SET_WIFI_AP_${index}`}
                      className="settings-list-row"
                      data-active={
                        !joinOther && selectedSsid === item.ssid ? "true" : "false"
                      }
                      data-in-use={item.inUse ? "true" : "false"}
                      onEnterPress={() => selectWifi(item)}
                    >
                      <span className="settings-list-row-main">
                        <strong>{item.ssid}</strong>
                        <span className="settings-list-meta">
                          <span>{item.inUse ? "Connected" : wifiLocked(item) ? "Locked" : "Open"}</span>
                          <span>signal {item.signal}</span>
                          {item.security && item.security !== "--" ? (
                            <span>{item.security}</span>
                          ) : null}
                        </span>
                      </span>
                    </Focusable>
                  ))
                )}
              </div>
              {(joinOther || showWifiPassword) && (
                <div className="settings-stack">
                  {joinOther ? (
                    <>
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
                          placeholder="Hidden or other SSID"
                          autoComplete="off"
                        />
                      </Focusable>
                    </>
                  ) : (
                    <p className="panel-copy">Password for {selectedSsid}</p>
                  )}
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
                    {busy ? "Working…" : joinOther ? "Save and connect" : "Connect"}
                  </Focusable>
                </div>
              )}
            </>
          )}

          {section === "bluetooth" && (
            <>
              <h3 className="panel-title">Bluetooth</h3>
              <p className="panel-copy">
                {bluetooth?.powered
                  ? bluetooth.discovering
                    ? "On · scanning"
                    : "On"
                  : bluetooth?.message || "Off"}
              </p>
              <div className="button-row">
                <Focusable
                  focusKey="SET_BT_POWER"
                  className="choice-chip"
                  data-active={bluetooth?.powered ? "true" : "false"}
                  onEnterPress={() =>
                    void runBluetooth("power", { powered: !bluetooth?.powered })
                  }
                >
                  {bluetooth?.powered ? "Bluetooth on" : "Bluetooth off"}
                </Focusable>
                <Focusable
                  focusKey="SET_BT_SCAN"
                  className="primary-btn"
                  onEnterPress={() => void runBluetooth("scan")}
                >
                  {busy ? "Working…" : "Scan"}
                </Focusable>
              </div>
              {pairedDevices.length > 0 ? (
                <>
                  <p className="settings-list-heading">Paired</p>
                  <div className="settings-list" role="list">
                    {pairedDevices.map((device) => (
                      <div key={device.address} className="settings-list-row-wrap">
                        <Focusable
                          focusKey={btFocusKey("SET_BT_DEV", device.address)}
                          className="settings-list-row"
                          data-active={btSelected === device.address ? "true" : "false"}
                          data-in-use={device.connected ? "true" : "false"}
                          onFocus={() => setBtSelected(device.address)}
                          onEnterPress={() => activateBluetoothDevice(device)}
                        >
                          <span className="settings-list-row-main">
                            <strong>{device.name}</strong>
                            <span className="settings-list-meta">
                              <span>{deviceMeta(device)}</span>
                              <span className="mono">{device.address}</span>
                            </span>
                          </span>
                        </Focusable>
                        <Focusable
                          focusKey={btFocusKey("SET_BT_FORGET", device.address)}
                          className="pager-btn"
                          onFocus={() => setBtSelected(device.address)}
                          onEnterPress={() =>
                            void runBluetooth("remove", { address: device.address })
                          }
                        >
                          Forget
                        </Focusable>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="panel-copy">No paired devices yet.</p>
              )}
              {bluetooth?.powered ? (
                <>
                  <p className="settings-list-heading">Nearby</p>
                  <div className="settings-list" role="list">
                    {nearbyDevices.length === 0 ? (
                      <p className="panel-copy">Scan to find remotes and other devices.</p>
                    ) : (
                      nearbyDevices.map((device) => (
                        <Focusable
                          key={device.address}
                          focusKey={btFocusKey("SET_BT_NEAR", device.address)}
                          className="settings-list-row"
                          data-active={btSelected === device.address ? "true" : "false"}
                          onFocus={() => setBtSelected(device.address)}
                          onEnterPress={() => activateBluetoothDevice(device)}
                        >
                          <span className="settings-list-row-main">
                            <strong>{device.name}</strong>
                            <span className="settings-list-meta">
                              <span>{deviceMeta(device)}</span>
                              <span className="mono">{device.address}</span>
                            </span>
                          </span>
                        </Focusable>
                      ))
                    )}
                  </div>
                </>
              ) : null}
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
                <label className="field-label" htmlFor="catalog-url">
                  App store catalog URL
                </label>
                <Focusable
                  as="div"
                  focusKey="SET_CATALOG"
                  className="store-field store-field-bare"
                  onEnterPress={() => {
                    document.getElementById("catalog-url")?.focus();
                  }}
                >
                  <input
                    id="catalog-url"
                    value={catalogUrl}
                    onChange={(e) => setCatalogUrl(e.target.value)}
                    placeholder="https://…/catalog/apps.json"
                    aria-label="App store catalog URL"
                  />
                </Focusable>
                <div className="button-row">
                  <Focusable
                    focusKey="SET_CATALOG_SAVE"
                    className="pager-btn"
                    onEnterPress={() => void saveCatalog()}
                  >
                    Save catalog URL
                  </Focusable>
                </div>
                <p className="panel-copy">
                  Hosted on your Next.js shell. Devices keep a local copy in{" "}
                  <code>data/catalog.json</code> and refresh when online.
                </p>

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
