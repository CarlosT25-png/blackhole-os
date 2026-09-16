"use client";

import { useEffect, useState } from "react";
import {
  FocusContext,
  setFocus,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import {
  api,
  type AdblockFiltering,
  type AspectRatio,
  type BluetoothDevice,
  type BluetoothStatus,
  type DeviceSettings,
  type NetworkStatus,
  type RefreshHz,
  type SystemInfo,
  type TimeClock,
  type TimeStatus,
  type UpdateStatus,
  type WifiNetwork,
} from "@/lib/api";
import { applyDisplay } from "@/lib/display";

type Section =
  | "about"
  | "network"
  | "bluetooth"
  | "display"
  | "datetime"
  | "power"
  | "adblock"
  | "updates";

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

type WifiDialogState =
  | { kind: "join-other"; ssid: string; password: string }
  | { kind: "password"; ssid: string; password: string }
  | null;

type BtDialogState = {
  address: string;
  name: string;
  pin: string;
} | null;

const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "about", label: "About", blurb: "Version and machine" },
  { id: "network", label: "Network", blurb: "Wi-Fi for this TV" },
  { id: "bluetooth", label: "Bluetooth", blurb: "Remotes and devices" },
  { id: "display", label: "Display", blurb: "Scale, aspect, refresh" },
  { id: "datetime", label: "Date & time", blurb: "Clock, zone, auto sync" },
  { id: "power", label: "Power", blurb: "Sleep and power off" },
  { id: "adblock", label: "Ad block", blurb: "uBlock Origin Lite" },
  { id: "updates", label: "Updates", blurb: "System and home screen" },
];

const SCALE_OPTIONS = [75, 90, 100, 125, 150] as const;
const ASPECT_OPTIONS: AspectRatio[] = ["auto", "16:9", "16:10", "4:3"];
const REFRESH_OPTIONS: RefreshHz[] = ["auto", 50, 60, 75, 120];
const FILTERING_OPTIONS: { id: AdblockFiltering; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "basic", label: "Basic" },
  { id: "optimal", label: "Optimal" },
  { id: "complete", label: "Complete" },
];
const IDLE_OPTIONS: { sec: number; label: string }[] = [
  { sec: 0, label: "Never" },
  { sec: 300, label: "5 min" },
  { sec: 900, label: "15 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 hour" },
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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

function zoneFocusKey(prefix: string, value: string) {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function zoneLabel(zone: string) {
  if (!zone.includes("/")) return zone.replaceAll("_", " ");
  return zone.split("/").slice(1).join(" / ").replaceAll("_", " ");
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function clockToIso(clock: TimeClock) {
  return `${clock.year}-${pad2(clock.month)}-${pad2(clock.day)}T${pad2(clock.hour)}:${pad2(clock.minute)}:00`;
}

function formatClock(clock: TimeClock, hour12: boolean) {
  const month = MONTHS[clock.month - 1] ?? String(clock.month);
  if (hour12) {
    const { display, period } = hour12Parts(clock.hour);
    return `${month} ${clock.day} · ${display}:${pad2(clock.minute)} ${period}`;
  }
  return `${month} ${clock.day} · ${pad2(clock.hour)}:${pad2(clock.minute)}`;
}

function hour12Parts(hour: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return { display, period };
}

function syncCopy(status: TimeStatus | null) {
  if (!status) return "Checking clock…";
  if (!status.ntp) return "Off — set the clock on this TV.";
  if (status.sync === "synced") return "Synced with the network.";
  if (status.sync === "waiting" || !status.networkOnline) return "Waiting for Wi-Fi.";
  return "Waiting to sync.";
}

function timezoneCopy(status: TimeStatus | null) {
  if (!status) return "Checking timezone…";
  if (!status.autoTimezone) return "Choose a timezone for this TV.";
  if (!status.networkOnline) return "Waiting for Wi-Fi to set the timezone.";
  return `Using ${zoneLabel(status.timezone)} from the network.`;
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="busy-row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function CredentialDialog({
  Focusable,
  title,
  copy,
  fields,
  submitLabel,
  busyLabel,
  busy,
  onClose,
  onSubmit,
}: {
  Focusable: (props: FocusableProps) => React.ReactElement;
  title: string;
  copy: string;
  fields: {
    id: string;
    focusKey: string;
    label: string;
    value: string;
    type?: string;
    placeholder?: string;
    onChange: (value: string) => void;
  }[];
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { ref, focusKey } = useFocusable({
    focusKey: "CREDENTIAL_DIALOG",
    trackChildren: true,
    isFocusBoundary: true,
  });

  useEffect(() => {
    const id = window.setTimeout(() => {
      const first = fields[0];
      if (first) {
        setFocus(first.focusKey);
        document.getElementById(first.id)?.focus();
      }
    }, 40);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus first field when dialog opens
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onClose]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className="modal-backdrop"
        onClick={() => {
          if (!busy) onClose();
        }}
        role="presentation"
      >
        <div
          ref={ref as never}
          className="modal-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="credential-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="credential-title" className="panel-title">
            {title}
          </h3>
          <p className="panel-copy">{copy}</p>
          {busy ? <Spinner label={busyLabel} /> : null}
          <div className="settings-stack">
            {fields.map((field) => (
              <div key={field.id}>
                <label className="field-label" htmlFor={field.id}>
                  {field.label}
                </label>
                <Focusable
                  as="div"
                  focusKey={field.focusKey}
                  className="store-field store-field-bare"
                  onEnterPress={() => {
                    if (!busy) document.getElementById(field.id)?.focus();
                  }}
                >
                  <input
                    id={field.id}
                    type={field.type || "text"}
                    value={field.value}
                    disabled={busy}
                    onChange={(e) => field.onChange(e.target.value)}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!busy) onSubmit();
                      }
                    }}
                  />
                </Focusable>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <Focusable
              focusKey="CREDENTIAL_CANCEL"
              className="ghost-btn"
              onEnterPress={() => {
                if (!busy) onClose();
              }}
            >
              Cancel
            </Focusable>
            <Focusable
              focusKey="CREDENTIAL_SUBMIT"
              className="primary-btn"
              onEnterPress={() => {
                if (!busy) onSubmit();
              }}
            >
              {busy ? busyLabel : submitLabel}
            </Focusable>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

function ConfirmDialog({
  Focusable,
  title,
  copy,
  confirmLabel,
  busyLabel,
  busy,
  onClose,
  onConfirm,
}: {
  Focusable: (props: FocusableProps) => React.ReactElement;
  title: string;
  copy: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { ref, focusKey } = useFocusable({
    focusKey: "CONFIRM_DIALOG",
    trackChildren: true,
    isFocusBoundary: true,
  });

  useEffect(() => {
    const id = window.setTimeout(() => setFocus("CONFIRM_CANCEL"), 40);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onClose]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className="modal-backdrop"
        onClick={() => {
          if (!busy) onClose();
        }}
        role="presentation"
      >
        <div
          ref={ref as never}
          className="modal-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="confirm-title" className="panel-title">
            {title}
          </h3>
          <p className="panel-copy">{copy}</p>
          {busy ? <Spinner label={busyLabel} /> : null}
          <div className="modal-actions">
            <Focusable
              focusKey="CONFIRM_CANCEL"
              className="ghost-btn"
              onEnterPress={() => {
                if (!busy) onClose();
              }}
            >
              Cancel
            </Focusable>
            <Focusable
              focusKey="CONFIRM_SUBMIT"
              className="primary-btn"
              onEnterPress={() => {
                if (!busy) onConfirm();
              }}
            >
              {busy ? busyLabel : confirmLabel}
            </Focusable>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

function TimeStepper({
  Focusable,
  focusKey,
  label,
  value,
  display,
  onChange,
  min,
  max,
  wrap = true,
}: {
  Focusable: (props: FocusableProps) => React.ReactElement;
  focusKey: string;
  label: string;
  value: number;
  display: string;
  onChange: (value: number) => void;
  min: number;
  max: number;
  wrap?: boolean;
}) {
  const step = (delta: number) => {
    const span = max - min + 1;
    if (wrap) {
      onChange(min + ((((value - min + delta) % span) + span) % span));
      return;
    }
    onChange(Math.min(max, Math.max(min, value + delta)));
  };

  return (
    <div className="time-stepper">
      <span className="time-stepper-label">{label}</span>
      <div className="time-stepper-controls">
        <Focusable
          focusKey={`${focusKey}_DEC`}
          className="choice-chip time-stepper-btn"
          onEnterPress={() => step(-1)}
        >
          −
        </Focusable>
        <span className="time-stepper-value">{display}</span>
        <Focusable
          focusKey={`${focusKey}_INC`}
          className="choice-chip time-stepper-btn"
          onEnterPress={() => step(1)}
        >
          +
        </Focusable>
      </div>
    </div>
  );
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
  const [scanning, setScanning] = useState(false);
  const [bluetooth, setBluetooth] = useState<BluetoothStatus | null>(null);
  const [btSelected, setBtSelected] = useState("");
  const [timeStatus, setTimeStatus] = useState<TimeStatus | null>(null);
  const [tzRegion, setTzRegion] = useState("");
  const [clockDraft, setClockDraft] = useState<TimeClock | null>(null);
  const [powerConfirm, setPowerConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wifiDialog, setWifiDialog] = useState<WifiDialogState>(null);
  const [btDialog, setBtDialog] = useState<BtDialogState>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsRes, networkRes] = await Promise.all([
          api.settings(),
          api.network(),
        ]);
        setSettings(settingsRes.settings);
        setNetwork(networkRes.network);
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
    if (section !== "bluetooth") return;
    void refreshBluetooth();
  }, [section]);

  const refreshTime = async () => {
    try {
      const status = await api.time();
      setTimeStatus(status);
      setClockDraft(status.clock);
      const current = status.timezone;
      const region = current.includes("/") ? current.split("/")[0] : current;
      setTzRegion((prev) => {
        if (prev && status.zones?.[prev]) return prev;
        if (status.zones?.[region]) return region;
        return Object.keys(status.zones || {})[0] || region || "UTC";
      });
      if (system) {
        onSystemChange({
          ...system,
          time: status,
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Clock unavailable", "error");
    }
  };

  useEffect(() => {
    if (section !== "datetime" && section !== "power") return;
    void refreshTime();
    if (section !== "datetime") return;
    const id = window.setInterval(() => {
      void refreshTime();
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when opening time/power
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

  const saveAdblock = async (filtering: AdblockFiltering) => {
    if (!settings) return;
    try {
      const res = await api.saveSettings({
        adblock: {
          ...settings.adblock,
          filtering,
        },
      });
      setSettings(res.settings);
      if (system) {
        onSystemChange({
          ...system,
          adblock: res.settings.adblock,
          ublock: {
            ...system.ublock,
            filtering: res.settings.adblock?.filtering ?? filtering,
          },
        });
      }
      showToast(`Ad block set to ${filtering}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save ad block", "error");
    }
  };

  const connectWifi = async (
    nextSsid: string,
    nextPassword: string,
    options?: { closeDialog?: boolean; rowKey?: string },
  ) => {
    if (!nextSsid.trim()) {
      showToast("Enter a network name", "error");
      return false;
    }
    setBusy(true);
    if (options?.rowKey) setRowBusy(options.rowKey);
    try {
      const res = await api.connectWifi(nextSsid.trim(), nextPassword);
      setNetwork(res.network);
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              network: res.settings,
            }
          : prev,
      );
      showToast(res.message);
      if (options?.closeDialog !== false) setWifiDialog(null);
      await refreshWifi();
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Wi-Fi failed", "error");
      return false;
    } finally {
      setBusy(false);
      setRowBusy(null);
    }
  };

  const selectWifi = (item: WifiNetwork) => {
    if (item.inUse) return;
    if (!wifiLocked(item)) {
      void connectWifi(item.ssid, "", { rowKey: `wifi:${item.ssid}` });
      return;
    }
    setWifiDialog({ kind: "password", ssid: item.ssid, password: "" });
  };

  const runBluetooth = async (
    action: "power" | "scan" | "pair" | "connect" | "disconnect" | "remove",
    extra?: { address?: string; powered?: boolean; pin?: string },
    options?: { closeDialog?: boolean; rowKey?: string },
  ) => {
    setBusy(true);
    if (options?.rowKey) setRowBusy(options.rowKey);
    try {
      const res = await api.bluetoothAction(action, extra);
      setBluetooth(res.bluetooth);
      showToast(res.message);
      if (options?.closeDialog) setBtDialog(null);
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bluetooth failed", "error");
      return false;
    } finally {
      setBusy(false);
      setRowBusy(null);
    }
  };

  const activateBluetoothDevice = (device: BluetoothDevice) => {
    setBtSelected(device.address);
    if (device.connected) {
      void runBluetooth("disconnect", { address: device.address }, {
        rowKey: `bt:${device.address}`,
      });
      return;
    }
    if (device.paired) {
      void runBluetooth("connect", { address: device.address }, {
        rowKey: `bt:${device.address}`,
      });
      return;
    }
    setBtDialog({ address: device.address, name: device.name, pin: "" });
  };

  const saveTime = async (payload: {
    timezone?: string;
    ntp?: boolean;
    autoTimezone?: boolean;
    hour12?: boolean;
    iso?: string;
  }) => {
    try {
      const res = await api.saveTime(payload);
      setSettings(res.settings);
      setTimeStatus(res.time);
      setClockDraft(res.time.clock);
      if (system) {
        onSystemChange({
          ...system,
          time: res.time,
        });
      }
      return res.time;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save time", "error");
      return null;
    }
  };

  const saveIdle = async (idleSec: number) => {
    if (!settings) return;
    try {
      const res = await api.saveSettings({
        power: {
          ...settings.power,
          idleSec,
        },
      });
      setSettings(res.settings);
      if (system) {
        onSystemChange({
          ...system,
          power: {
            idleSec: res.settings.power?.idleSec ?? idleSec,
            sleeping: system.power?.sleeping ?? false,
            backend: system.power?.backend ?? "dev",
          },
        });
      }
      showToast(idleSec ? `Sleep after ${IDLE_OPTIONS.find((item) => item.sec === idleSec)?.label ?? idleSec}` : "Sleep timer off");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save power", "error");
    }
  };

  const runPower = async (action: "sleep" | "poweroff") => {
    setBusy(true);
    try {
      const res = await api.powerAction(action);
      if (system && res.power) {
        onSystemChange({
          ...system,
          power: res.power,
        });
      }
      showToast(res.message || (action === "sleep" ? "Sleeping" : "Powering off"));
      if (action === "poweroff") setPowerConfirm(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Power action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setBusy(true);
    try {
      const [shellResult, status] = await Promise.all([
        api.syncShell(),
        api.checkUpdate(),
      ]);
      if (system) {
        onSystemChange({
          ...system,
          panelUrl: shellResult.shellUrl,
          shellVersion: shellResult.shellVersion,
          shellSynced: shellResult.shellSynced,
          shellReady: shellResult.shellReady,
        });
      }
      onUpdateChange(status);
      const bits = [shellResult.message, status.message].filter(Boolean);
      showToast(bits.join(" · ") || "Checked for updates", shellResult.ok ? "info" : "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Check failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const installFromChannel = async () => {
    setBusy(true);
    try {
      const res = await api.installUpdate({ fromChannel: true });
      showToast(res.message);
      onUpdateChange(await api.update());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Install failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const scale = settings?.display?.scale ?? 100;
  const reducedMotion = settings?.display?.reducedMotion ?? false;
  const aspect = settings?.display?.aspect ?? "auto";
  const refreshHz = settings?.display?.refreshHz ?? "auto";
  const filtering =
    settings?.adblock?.filtering ?? system?.ublock?.filtering ?? "optimal";
  const pairedDevices = bluetooth?.devices.filter((item) => item.paired) ?? [];
  const nearbyDevices =
    bluetooth?.devices.filter((item) => !item.paired && bluetooth.powered) ?? [];
  const hour12 = timeStatus?.hour12 ?? settings?.time?.hour12 ?? true;
  const ntpOn = timeStatus?.ntp ?? settings?.time?.ntp ?? true;
  const autoTimezone = timeStatus?.autoTimezone ?? settings?.time?.autoTimezone ?? true;
  const idleSec = settings?.power?.idleSec ?? 0;
  const zones = timeStatus?.zones ?? {};
  const regionNames = Object.keys(zones);
  const regionZones = tzRegion ? zones[tzRegion] ?? [] : [];
  const clock = clockDraft ?? timeStatus?.clock;
  const hourParts = clock ? hour12Parts(clock.hour) : { display: 12, period: "AM" };
  const maxDay = clock ? daysInMonth(clock.year, clock.month) : 31;
  const canInstall = Boolean(update?.remote?.newer || update?.updateAvailable);

  return (
    <section className="settings-view">
      <div>
        <h2 className="view-title">Settings</h2>
        <p className="view-lede">Network, Bluetooth, display, time, and power for this TV.</p>
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
                  onEnterPress={() =>
                    setWifiDialog({ kind: "join-other", ssid: "", password: "" })
                  }
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
                      data-active="false"
                      data-in-use={item.inUse ? "true" : "false"}
                      data-busy={rowBusy === `wifi:${item.ssid}` ? "true" : "false"}
                      onEnterPress={() => selectWifi(item)}
                    >
                      <span className="settings-list-row-main">
                        <strong>{item.ssid}</strong>
                        <span className="settings-list-meta">
                          <span>
                            {rowBusy === `wifi:${item.ssid}`
                              ? "Connecting…"
                              : item.inUse
                                ? "Connected"
                                : wifiLocked(item)
                                  ? "Locked"
                                  : "Open"}
                          </span>
                          <span>signal {item.signal}</span>
                          {item.security && item.security !== "--" ? (
                            <span>{item.security}</span>
                          ) : null}
                        </span>
                      </span>
                      {rowBusy === `wifi:${item.ssid}` ? (
                        <span className="spinner spinner-inline" aria-hidden="true" />
                      ) : null}
                    </Focusable>
                  ))
                )}
              </div>
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
                  {busy && !btDialog && !rowBusy ? "Working…" : "Scan"}
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
                          data-busy={rowBusy === `bt:${device.address}` ? "true" : "false"}
                          onFocus={() => setBtSelected(device.address)}
                          onEnterPress={() => activateBluetoothDevice(device)}
                        >
                          <span className="settings-list-row-main">
                            <strong>{device.name}</strong>
                            <span className="settings-list-meta">
                              <span>
                                {rowBusy === `bt:${device.address}`
                                  ? device.connected
                                    ? "Disconnecting…"
                                    : "Connecting…"
                                  : deviceMeta(device)}
                              </span>
                              <span className="mono">{device.address}</span>
                            </span>
                          </span>
                          {rowBusy === `bt:${device.address}` ? (
                            <span className="spinner spinner-inline" aria-hidden="true" />
                          ) : null}
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
                          data-busy={rowBusy === `bt:${device.address}` ? "true" : "false"}
                          onFocus={() => setBtSelected(device.address)}
                          onEnterPress={() => activateBluetoothDevice(device)}
                        >
                          <span className="settings-list-row-main">
                            <strong>{device.name}</strong>
                            <span className="settings-list-meta">
                              <span>
                                {rowBusy === `bt:${device.address}`
                                  ? "Pairing…"
                                  : deviceMeta(device)}
                              </span>
                              <span className="mono">{device.address}</span>
                            </span>
                          </span>
                          {rowBusy === `bt:${device.address}` ? (
                            <span className="spinner spinner-inline" aria-hidden="true" />
                          ) : null}
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
                {SCALE_OPTIONS.map((value) => (
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

              <p className="panel-copy">Aspect ratio for this display.</p>
              <div className="choice-row" role="group" aria-label="Aspect ratio">
                {ASPECT_OPTIONS.map((value) => (
                  <Focusable
                    key={value}
                    focusKey={`SET_ASPECT_${value.replace(":", "_")}`}
                    className="choice-chip"
                    data-active={aspect === value ? "true" : "false"}
                    onEnterPress={() => void saveDisplay({ aspect: value })}
                  >
                    {value === "auto" ? "Auto" : value}
                  </Focusable>
                ))}
              </div>

              <p className="panel-copy">Refresh rate. Applies on the TV image.</p>
              <div className="choice-row" role="group" aria-label="Refresh rate">
                {REFRESH_OPTIONS.map((value) => (
                  <Focusable
                    key={String(value)}
                    focusKey={`SET_HZ_${value}`}
                    className="choice-chip"
                    data-active={refreshHz === value ? "true" : "false"}
                    onEnterPress={() => void saveDisplay({ refreshHz: value })}
                  >
                    {value === "auto" ? "Auto" : `${value} Hz`}
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

          {section === "datetime" && (
            <>
              <h3 className="panel-title">Date & time</h3>
              <p className="time-clock" aria-live="polite">
                {clock ? formatClock(clock, hour12) : "—"}
              </p>
              <p className="panel-copy">{syncCopy(timeStatus)}</p>

              <p className="panel-copy">Automatic time. Syncs when Wi-Fi is available.</p>
              <Focusable
                focusKey="SET_NTP"
                className="choice-chip choice-chip-wide"
                data-active={ntpOn ? "true" : "false"}
                onEnterPress={() => {
                  void saveTime({ ntp: !ntpOn }).then((next) => {
                    if (next) showToast(next.ntp ? "Automatic time on" : "Automatic time off");
                  });
                }}
              >
                {ntpOn ? "Automatic time on" : "Automatic time off"}
              </Focusable>

              <p className="panel-copy">{timezoneCopy(timeStatus)}</p>
              <Focusable
                focusKey="SET_AUTO_TZ"
                className="choice-chip choice-chip-wide"
                data-active={autoTimezone ? "true" : "false"}
                onEnterPress={() => {
                  void saveTime({ autoTimezone: !autoTimezone }).then((next) => {
                    if (next) {
                      showToast(
                        next.autoTimezone
                          ? "Automatic timezone on"
                          : "Automatic timezone off",
                      );
                    }
                  });
                }}
              >
                {autoTimezone ? "Automatic timezone on" : "Automatic timezone off"}
              </Focusable>

              <p className="panel-copy">Clock format.</p>
              <div className="choice-row" role="group" aria-label="Clock format">
                <Focusable
                  focusKey="SET_HOUR12"
                  className="choice-chip"
                  data-active={hour12 ? "true" : "false"}
                  onEnterPress={() => {
                    void saveTime({ hour12: true }).then((next) => {
                      if (next) showToast("12-hour clock");
                    });
                  }}
                >
                  12-hour
                </Focusable>
                <Focusable
                  focusKey="SET_HOUR24"
                  className="choice-chip"
                  data-active={!hour12 ? "true" : "false"}
                  onEnterPress={() => {
                    void saveTime({ hour12: false }).then((next) => {
                      if (next) showToast("24-hour clock");
                    });
                  }}
                >
                  24-hour
                </Focusable>
              </div>

              {!autoTimezone ? (
                <>
              <p className="panel-copy">Timezone region.</p>
              <div className="choice-row" role="group" aria-label="Timezone region">
                {regionNames.map((region) => (
                  <Focusable
                    key={region}
                    focusKey={zoneFocusKey("SET_TZ_REGION", region)}
                    className="choice-chip"
                    data-active={tzRegion === region ? "true" : "false"}
                    onEnterPress={() => setTzRegion(region)}
                  >
                    {region.replaceAll("_", " ")}
                  </Focusable>
                ))}
              </div>

              {regionZones.length ? (
                <>
                  <p className="settings-list-heading">City</p>
                  <div className="settings-list" role="list">
                    {regionZones.map((zone) => (
                      <Focusable
                        key={zone}
                        focusKey={zoneFocusKey("SET_TZ_ZONE", zone)}
                        className="settings-list-row"
                        data-active={timeStatus?.timezone === zone ? "true" : "false"}
                        onEnterPress={() => {
                          void saveTime({ timezone: zone }).then((next) => {
                            if (next) showToast(zoneLabel(zone));
                          });
                        }}
                      >
                        <span className="settings-list-row-main">
                          <strong>{zoneLabel(zone)}</strong>
                          <span className="settings-list-meta">{zone}</span>
                        </span>
                      </Focusable>
                    ))}
                  </div>
                </>
              ) : null}
                </>
              ) : null}

              {!ntpOn && clock ? (
                <>
                  <p className="panel-copy">Set the clock on this TV.</p>
                  <div className="time-steppers">
                    <TimeStepper
                      Focusable={Focusable}
                      focusKey="SET_YEAR"
                      label="Year"
                      value={clock.year}
                      display={String(clock.year)}
                      min={2020}
                      max={2038}
                      wrap={false}
                      onChange={(year) =>
                        setClockDraft({
                          ...clock,
                          year,
                          day: Math.min(clock.day, daysInMonth(year, clock.month)),
                        })
                      }
                    />
                    <TimeStepper
                      Focusable={Focusable}
                      focusKey="SET_MONTH"
                      label="Month"
                      value={clock.month}
                      display={MONTHS[clock.month - 1] ?? String(clock.month)}
                      min={1}
                      max={12}
                      onChange={(month) =>
                        setClockDraft({
                          ...clock,
                          month,
                          day: Math.min(clock.day, daysInMonth(clock.year, month)),
                        })
                      }
                    />
                    <TimeStepper
                      Focusable={Focusable}
                      focusKey="SET_DAY"
                      label="Day"
                      value={clock.day}
                      display={String(clock.day)}
                      min={1}
                      max={maxDay}
                      onChange={(day) => setClockDraft({ ...clock, day })}
                    />
                    {hour12 ? (
                      <>
                        <TimeStepper
                          Focusable={Focusable}
                          focusKey="SET_HOUR"
                          label="Hour"
                          value={hourParts.display}
                          display={String(hourParts.display)}
                          min={1}
                          max={12}
                          onChange={(nextHour) => {
                            const hour24 =
                              hourParts.period === "AM"
                                ? nextHour % 12
                                : (nextHour % 12) + 12;
                            setClockDraft({ ...clock, hour: hour24 });
                          }}
                        />
                        <Focusable
                          focusKey="SET_PERIOD"
                          className="choice-chip choice-chip-wide"
                          data-active="true"
                          onEnterPress={() => {
                            const hour =
                              hourParts.period === "AM"
                                ? (clock.hour % 12) + 12
                                : clock.hour % 12;
                            setClockDraft({ ...clock, hour });
                          }}
                        >
                          {hourParts.period}
                        </Focusable>
                      </>
                    ) : (
                      <TimeStepper
                        Focusable={Focusable}
                        focusKey="SET_HOUR"
                        label="Hour"
                        value={clock.hour}
                        display={pad2(clock.hour)}
                        min={0}
                        max={23}
                        onChange={(hour) => setClockDraft({ ...clock, hour })}
                      />
                    )}
                    <TimeStepper
                      Focusable={Focusable}
                      focusKey="SET_MINUTE"
                      label="Minute"
                      value={clock.minute}
                      display={pad2(clock.minute)}
                      min={0}
                      max={59}
                      onChange={(minute) => setClockDraft({ ...clock, minute })}
                    />
                  </div>
                  <div className="button-row">
                    <Focusable
                      focusKey="SET_TIME_SAVE"
                      className="primary-btn"
                      onEnterPress={() => {
                        void saveTime({ iso: clockToIso(clock) }).then((next) => {
                          if (next) showToast("Clock saved");
                        });
                      }}
                    >
                      Save clock
                    </Focusable>
                  </div>
                </>
              ) : null}
            </>
          )}

          {section === "power" && (
            <>
              <h3 className="panel-title">Power</h3>
              <p className="panel-copy">
                Sleep turns the screen off. Keyboard, mouse, or remote wakes it.
              </p>
              <div className="button-row">
                <Focusable
                  focusKey="SET_SLEEP"
                  className="primary-btn"
                  onEnterPress={() => void runPower("sleep")}
                >
                  Sleep
                </Focusable>
                <Focusable
                  focusKey="SET_POWEROFF"
                  className="pager-btn"
                  onEnterPress={() => setPowerConfirm(true)}
                >
                  Power off
                </Focusable>
              </div>
              <p className="panel-copy">Sleep after no input.</p>
              <div className="choice-row" role="group" aria-label="Sleep timer">
                {IDLE_OPTIONS.map((item) => (
                  <Focusable
                    key={item.sec}
                    focusKey={`SET_IDLE_${item.sec}`}
                    className="choice-chip"
                    data-active={idleSec === item.sec ? "true" : "false"}
                    onEnterPress={() => void saveIdle(item.sec)}
                  >
                    {item.label}
                  </Focusable>
                ))}
              </div>
            </>
          )}

          {section === "adblock" && (
            <>
              <h3 className="panel-title">Ad block</h3>
              <p className={system?.ublock.enabled ? "status-ok" : "status-fault"}>
                {system?.ublock.enabled
                  ? "uBlock Origin Lite is enabled in the Chromium kiosk"
                  : "uBlock Origin Lite was not detected"}
              </p>
              <p className="panel-copy">
                {system?.ublock.note ||
                  "Loaded with --load-extension on every kiosk start."}
              </p>
              <p className="panel-copy">Filtering level for all sites.</p>
              <div className="choice-row" role="group" aria-label="Ad block level">
                {FILTERING_OPTIONS.map((item) => (
                  <Focusable
                    key={item.id}
                    focusKey={`SET_ADBLOCK_${item.id.toUpperCase()}`}
                    className="choice-chip"
                    data-active={filtering === item.id ? "true" : "false"}
                    onEnterPress={() => void saveAdblock(item.id)}
                  >
                    {item.label}
                  </Focusable>
                ))}
              </div>
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
                <div>
                  <dt>Home screen</dt>
                  <dd>
                    {system?.shellVersion
                      ? `${system.shellVersion.slice(0, 12)}…`
                      : system?.shellReady
                        ? "Ready"
                        : "Not ready"}
                  </dd>
                </div>
                {update?.remote ? (
                  <div>
                    <dt>Available</dt>
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

              <div className="button-row">
                <Focusable
                  focusKey="SET_CHECK"
                  className="primary-btn"
                  onEnterPress={() => void checkForUpdates()}
                >
                  {busy ? "Checking…" : "Check for updates"}
                </Focusable>
                {canInstall ? (
                  <Focusable
                    focusKey="SET_INSTALL_CHANNEL"
                    className="primary-btn"
                    onEnterPress={() => void installFromChannel()}
                  >
                    {busy ? "Installing…" : "Install update"}
                  </Focusable>
                ) : null}
              </div>
              <p className="panel-copy">
                Checks the home screen and the system image from GitHub Releases.
                A system update will show up here when one is published.
              </p>
            </>
          )}
        </div>
      </div>

      {wifiDialog ? (
        <CredentialDialog
          Focusable={Focusable}
          title={
            wifiDialog.kind === "join-other"
              ? "Join other network"
              : `Connect to ${wifiDialog.ssid}`
          }
          copy={
            wifiDialog.kind === "join-other"
              ? "Enter the network name and password."
              : "Enter the Wi-Fi password for this network."
          }
          fields={
            wifiDialog.kind === "join-other"
              ? [
                  {
                    id: "wifi-dialog-ssid",
                    focusKey: "WIFI_SSID",
                    label: "Network name",
                    value: wifiDialog.ssid,
                    placeholder: "Hidden or other SSID",
                    onChange: (value) =>
                      setWifiDialog({ ...wifiDialog, ssid: value }),
                  },
                  {
                    id: "wifi-dialog-pass",
                    focusKey: "WIFI_PASS",
                    label: "Password",
                    value: wifiDialog.password,
                    type: "password",
                    placeholder: "Optional on open networks",
                    onChange: (value) =>
                      setWifiDialog({ ...wifiDialog, password: value }),
                  },
                ]
              : [
                  {
                    id: "wifi-dialog-pass",
                    focusKey: "WIFI_PASS",
                    label: "Password",
                    value: wifiDialog.password,
                    type: "password",
                    placeholder: "Network password",
                    onChange: (value) =>
                      setWifiDialog({ ...wifiDialog, password: value }),
                  },
                ]
          }
          submitLabel="Connect"
          busyLabel="Connecting…"
          busy={busy}
          onClose={() => {
            if (!busy) setWifiDialog(null);
          }}
          onSubmit={() => {
            void connectWifi(wifiDialog.ssid, wifiDialog.password, {
              closeDialog: true,
            });
          }}
        />
      ) : null}

      {btDialog ? (
        <CredentialDialog
          Focusable={Focusable}
          title={`Pair ${btDialog.name}`}
          copy="Enter a PIN if the device shows one. Leave blank for Just Works pairing."
          fields={[
            {
              id: "bt-dialog-pin",
              focusKey: "BT_PIN",
              label: "PIN / passkey",
              value: btDialog.pin,
              type: "password",
              placeholder: "Optional",
              onChange: (value) => setBtDialog({ ...btDialog, pin: value }),
            },
          ]}
          submitLabel="Pair"
          busyLabel="Pairing…"
          busy={busy}
          onClose={() => {
            if (!busy) setBtDialog(null);
          }}
          onSubmit={() => {
            void runBluetooth(
              "pair",
              {
                address: btDialog.address,
                pin: btDialog.pin.trim() || undefined,
              },
              { closeDialog: true, rowKey: `bt:${btDialog.address}` },
            );
          }}
        />
      ) : null}

      {powerConfirm ? (
        <ConfirmDialog
          Focusable={Focusable}
          title="Power off?"
          copy="This TV will shut down. Use the power button on the device to turn it back on."
          confirmLabel="Power off"
          busyLabel="Powering off…"
          busy={busy}
          onClose={() => {
            if (!busy) setPowerConfirm(false);
          }}
          onConfirm={() => void runPower("poweroff")}
        />
      ) : null}
    </section>
  );
}
