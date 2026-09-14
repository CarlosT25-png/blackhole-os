const SHELL_CANDIDATES = [
  "http://127.0.0.1/",
  "http://127.0.0.1:80/",
  "http://127.0.0.1:3000/",
  "http://localhost:3000/",
];

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "go-home") {
    goHome().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "navigate" && typeof message.url === "string") {
    navigate(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function pollLaunch() {
  try {
    const response = await fetch("http://127.0.0.1:8081/launch");
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (payload.shell) {
      await chrome.storage.local.set({ shellUrl: payload.shell });
    }
    if (payload.pending && payload.url) {
      await navigate(payload.url);
      await fetch("http://127.0.0.1:8081/launch/ack", { method: "POST" });
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
  void pollLaunch();
});

// Alarms minimum is ~1 minute in stable Chrome; also poll on a timer in SW
// when it is woken. Content scripts can nudge us.
setInterval(() => {
  void pollLaunch();
}, 2000);
