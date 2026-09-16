export type AppRecord = {
  id: string;
  name: string;
  description?: string;
  manifestUrl?: string;
  startUrl: string;
  icon?: string | null;
  display?: string;
  source?: string;
  category?: string;
};

export type AspectRatio = "auto" | "16:9" | "16:10" | "4:3";
export type RefreshHz = "auto" | 50 | 60 | 75 | 120;
export type AdblockFiltering = "none" | "basic" | "optimal" | "complete";

export type DisplaySettings = {
  scale: number;
  reducedMotion: boolean;
  aspect: AspectRatio;
  refreshHz: RefreshHz;
};

export type AdblockSettings = {
  filtering: AdblockFiltering;
  extensionId?: string;
};

export type NetworkSettings = {
  ssid: string;
  password: string;
  mode: string;
};

export type TimeClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type TimeSettings = {
  timezone: string;
  ntp: boolean;
  autoTimezone: boolean;
  hour12: boolean;
};

export type PowerSettings = {
  idleSec: number;
};

export type DeviceSettings = {
  channelUrl: string;
  catalogUrl: string;
  shellUrl: string;
  display: DisplaySettings;
  adblock: AdblockSettings;
  network: NetworkSettings;
  time: TimeSettings;
  power: PowerSettings;
};

export type TimeStatus = {
  timezone: string;
  ntp: boolean;
  autoTimezone?: boolean;
  ntpActive?: boolean;
  synchronized: boolean;
  sync: "synced" | "waiting" | "pending" | "off";
  iso: string;
  clock: TimeClock;
  hour12: boolean;
  networkOnline: boolean;
  backend: string;
  zones?: Record<string, string[]>;
};

export type PowerStatus = {
  idleSec: number;
  sleeping: boolean;
  idleFor?: number;
  backend: string;
};

export type NetworkStatus = {
  connected: boolean;
  ssid?: string | null;
  signal?: string;
  device?: string;
  backend: string;
  message?: string;
};

export type WifiNetwork = {
  ssid: string;
  signal: string;
  security: string;
  inUse: boolean;
  bssid?: string;
};

export type BluetoothDevice = {
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
  trusted?: boolean;
};

export type BluetoothStatus = {
  powered: boolean;
  discovering: boolean;
  backend: string;
  devices: BluetoothDevice[];
  message?: string;
};

export type SystemInfo = {
  name: string;
  version: string;
  machine: string;
  shellUrl: string;
  ublock: {
    enabled: boolean;
    extension: string;
    note: string;
    filtering?: AdblockFiltering;
  };
  dev: boolean;
  dataDir: string;
  channelUrl?: string;
  catalogUrl?: string;
  panelUrl?: string;
  shellVersion?: string | null;
  shellSynced?: boolean;
  shellReady?: boolean;
  display?: DisplaySettings;
  adblock?: AdblockSettings;
  time?: TimeStatus;
  power?: PowerStatus;
};

export type RemoteUpdate = {
  version: string;
  bundleUrl: string;
  sha256?: string | null;
  notes?: string;
  newer: boolean;
};

export type UpdateStatus = {
  available: boolean;
  dev: boolean;
  slot: string;
  compatible: string;
  version?: string;
  channelUrl?: string;
  message: string;
  raw?: string;
  remote?: RemoteUpdate | null;
  updateAvailable?: boolean;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://127.0.0.1:8081";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }

  return response.json() as Promise<T>;
}

export const api = {
  catalog: () => request<{ apps: AppRecord[] }>("/catalog"),
  apps: () => request<{ apps: AppRecord[] }>("/apps"),
  install: (manifestUrl: string) =>
    request<{ app: AppRecord; apps: AppRecord[] }>("/apps", {
      method: "POST",
      body: JSON.stringify({ manifestUrl }),
    }),
  uninstall: (id: string) =>
    request<{ apps: AppRecord[] }>(`/apps/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  reorder: (ids: string[]) =>
    request<{ apps: AppRecord[] }>("/apps/order", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  launch: (id: string) =>
    request<{ url: string }>(`/apps/${encodeURIComponent(id)}/launch`, {
      method: "POST",
    }),
  system: () => request<SystemInfo>("/system"),
  settings: () => request<{ settings: DeviceSettings }>("/settings"),
  saveSettings: (settings: Partial<DeviceSettings>) =>
    request<{ settings: DeviceSettings }>("/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    }),
  network: () =>
    request<{ network: NetworkStatus; settings: NetworkSettings }>("/network"),
  connectWifi: (ssid: string, password: string) =>
    request<{
      ok: boolean;
      message: string;
      network: NetworkStatus;
      settings: NetworkSettings;
    }>("/network", {
      method: "POST",
      body: JSON.stringify({ ssid, password }),
    }),
  scanWifi: () =>
    request<{
      networks: WifiNetwork[];
      network: NetworkStatus;
      settings?: NetworkSettings;
      backend?: string;
      message?: string;
    }>("/network/scan"),
  bluetooth: () => request<{ bluetooth: BluetoothStatus }>("/bluetooth"),
  bluetoothAction: (
    action: "power" | "scan" | "pair" | "connect" | "disconnect" | "remove",
    extra?: { address?: string; powered?: boolean; pin?: string },
  ) =>
    request<{ ok: boolean; message: string; bluetooth: BluetoothStatus }>("/bluetooth", {
      method: "POST",
      body: JSON.stringify({ action, ...extra }),
    }),
  update: () => request<UpdateStatus>("/update"),
  checkUpdate: (channelUrl?: string) =>
    request<UpdateStatus>("/update/check", {
      method: "POST",
      body: JSON.stringify(channelUrl ? { channelUrl } : {}),
    }),
  installUpdate: (payload: {
    bundlePath?: string;
    bundleUrl?: string;
    fromChannel?: boolean;
    channelUrl?: string;
    sha256?: string;
  }) =>
    request<{ ok: boolean; message: string }>("/update", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  syncShell: (shellUrl?: string) =>
    request<{
      ok: boolean;
      updated: boolean;
      message: string;
      shellUrl?: string;
      shellVersion?: string | null;
      shellSynced?: boolean;
      shellReady?: boolean;
    }>("/shell/sync", {
      method: "POST",
      body: JSON.stringify(shellUrl ? { shellUrl } : {}),
    }),
  time: () => request<TimeStatus>("/time"),
  saveTime: (payload: {
    timezone?: string;
    ntp?: boolean;
    autoTimezone?: boolean;
    hour12?: boolean;
    iso?: string;
  }) =>
    request<{ ok: boolean; time: TimeStatus; settings: DeviceSettings }>("/time", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  power: () => request<PowerStatus>("/power"),
  powerAction: (action: "sleep" | "wake" | "poweroff" | "activity") =>
    request<{
      ok: boolean;
      action: string;
      backend?: string;
      message?: string;
      power?: PowerStatus;
    }>("/power", {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
};

export { API_BASE };
