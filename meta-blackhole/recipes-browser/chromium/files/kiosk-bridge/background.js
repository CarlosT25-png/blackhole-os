const SHELL_CANDIDATES = [
  "http://127.0.0.1/",
  "http://127.0.0.1:80/",
  "http://127.0.0.1:3000/",
  "http://localhost:3000/",
];

const API_BASE = "http://127.0.0.1:8081";
const FILTERING_LEVELS = ["none", "basic", "optimal", "complete"];

async function resolveShellUrl() {
  const stored = await chrome.storage.local.get(["shellUrl"]);
  if (stored.shellUrl) {
    return stored.shellUrl;
  }

  for (const url of SHELL_CANDIDATES) {
    try {
      await fetch(url, { method: "HEAD", mode: "no-cors" });
      await chrome.storage.local.set({ shellUrl: url });
      return url;
    } catch {
      /* try next */
    }
  }

  return "http://127.0.0.1:3000/";
}

async function goHome() {
  const shell = await resolveShellUrl();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { url: shell });
  } else {
    await chrome.tabs.create({ url: shell });
  }
}

async function navigate(url) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { url });
  }
}

async function findUblockExtension() {
  try {
    const extensions = await chrome.management.getAll();
    return (
      extensions.find((item) => {
        const name = String(item.name || "").toLowerCase();
        return name.includes("ublock") && item.type === "extension";
      }) || null
    );
  } catch {
    return null;
  }
}

async function reloadUblock() {
  const ublock = await findUblockExtension();
  if (!ublock?.id) {
    return { ok: false, message: "uBlock Origin Lite not found" };
  }
  try {
    await chrome.management.setEnabled(ublock.id, false);
    await chrome.management.setEnabled(ublock.id, true);
    return { ok: true, extensionId: ublock.id };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not reload uBlock",
    };
  }
}

async function reportExtensionId() {
  const ublock = await findUblockExtension();
  if (!ublock?.id) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/settings`);
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const current = payload?.settings?.adblock || {};
    if (current.extensionId === ublock.id) {
      return;
    }
    await fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          adblock: {
            ...current,
            extensionId: ublock.id,
          },
        },
      }),
    });
  } catch {
    /* daemon offline */
  }
}

async function setFiltering(level) {
  if (!FILTERING_LEVELS.includes(level)) {
    return { ok: false, message: "Invalid filtering level" };
  }
  try {
    const response = await fetch(`${API_BASE}/settings`);
    if (!response.ok) {
      throw new Error("Could not load settings");
    }
    const payload = await response.json();
    const current = payload?.settings?.adblock || {};
    const ublock = await findUblockExtension();
    const save = await fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          adblock: {
            ...current,
            filtering: level,
            extensionId: ublock?.id || current.extensionId || "",
          },
        },
      }),
    });
    if (!save.ok) {
      throw new Error("Could not save filtering level");
    }
    const reload = await reloadUblock();
    return {
      ok: true,
      filtering: level,
      reloaded: Boolean(reload.ok),
      message: reload.ok ? `Ad block: ${level}` : `Saved ${level}; reload uBlock manually`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not update ad block",
    };
  }
}

async function getFiltering() {
  try {
    const response = await fetch(`${API_BASE}/settings`);
    if (!response.ok) {
      return { filtering: "optimal" };
    }
    const payload = await response.json();
    return {
      filtering: payload?.settings?.adblock?.filtering || "optimal",
      scale: payload?.settings?.display?.scale || 100,
    };
  } catch {
    return { filtering: "optimal", scale: 100 };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "go-home") {
    goHome().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "navigate" && typeof message.url === "string") {
    navigate(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "get-settings") {
    getFiltering().then((result) => sendResponse(result));
    return true;
  }
  if (message?.type === "set-filtering" && typeof message.level === "string") {
    setFiltering(message.level).then((result) => sendResponse(result));
    return true;
  }
  if (message?.type === "reload-ublock") {
    reloadUblock().then((result) => sendResponse(result));
    return true;
  }
  return false;
});

async function pollLaunch() {
  try {
    const response = await fetch(`${API_BASE}/launch`);
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (payload.shell) {
      await chrome.storage.local.set({ shellUrl: payload.shell });
    }
    if (payload.pending && payload.url) {
      await navigate(payload.url);
      await fetch(`${API_BASE}/launch/ack`, { method: "POST" });
    }
  } catch {
    /* daemon offline */
  }
}

chrome.alarms.create("blackhole-poll", { periodInMinutes: 0.05 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "blackhole-poll") {
    void pollLaunch();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void resolveShellUrl();
  void reportExtensionId();
  void pollLaunch();
});

chrome.runtime.onStartup.addListener(() => {
  void reportExtensionId();
});

setInterval(() => {
  void pollLaunch();
}, 2000);

void reportExtensionId();
