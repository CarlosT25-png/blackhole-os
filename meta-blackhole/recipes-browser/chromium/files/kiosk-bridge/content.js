(function blackholeKioskBridge() {
  const SHELL_HINTS = ["127.0.0.1", "localhost"];
  const SHELL_FALLBACKS = [
    "http://127.0.0.1:3000/",
    "http://127.0.0.1/",
    "http://localhost:3000/",
  ];
  const ROOT_ID = "blackhole-home-root";
  const FILTERING_LEVELS = [
    { id: "none", label: "Off" },
    { id: "basic", label: "Basic" },
    { id: "optimal", label: "Optimal" },
    { id: "complete", label: "Complete" },
  ];
  const isTop = window === window.top;
  let lastHandledUrl = null;
  let homeBtn = null;
  let observer = null;
  let currentFiltering = "optimal";
  let lastActivityPing = 0;

  function isShellPage() {
    try {
      return SHELL_HINTS.includes(window.location.hostname);
    } catch {
      return false;
    }
  }

  function goHome() {
    try {
      chrome.runtime.sendMessage({ type: "go-home" }, () => {
        if (chrome.runtime.lastError) {
          window.top.location.assign(SHELL_FALLBACKS[0]);
        }
      });
    } catch {
      try {
        window.top.location.assign(SHELL_FALLBACKS[0]);
      } catch {
        window.location.assign(SHELL_FALLBACKS[0]);
      }
    }
  }

  function navigate(url) {
    if (!url || url === lastHandledUrl) {
      return;
    }
    lastHandledUrl = url;
    try {
      chrome.runtime.sendMessage({ type: "navigate", url }, () => {
        if (chrome.runtime.lastError) {
          window.location.assign(url);
        }
      });
    } catch {
      window.location.assign(url);
    }
    window.setTimeout(() => {
      if (window.location.href !== url) {
        window.location.assign(url);
      }
    }, 120);
  }

  function applyPageZoom(scale) {
    if (!document.body) {
      return;
    }
    const factor = Number(scale || 100) / 100;
    document.body.style.zoom = String(factor);
  }

  function syncSettings() {
    try {
      chrome.runtime.sendMessage({ type: "get-settings" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          return;
        }
        if (response.filtering) {
          currentFiltering = response.filtering;
          updateFilteringUi();
        }
        if (response.scale != null) {
          applyPageZoom(response.scale);
        }
      });
    } catch {
      /* extension context */
    }
  }

  function setFiltering(level) {
    currentFiltering = level;
    updateFilteringUi();
    try {
      chrome.runtime.sendMessage({ type: "set-filtering", level }, () => {
        /* ignore */
      });
    } catch {
      /* extension context */
    }
  }

  function updateFilteringUi() {
    if (!homeBtn || !homeBtn.shadowRoot) {
      return;
    }
    homeBtn.shadowRoot.querySelectorAll("[data-level]").forEach((button) => {
      const active = button.getAttribute("data-level") === currentFiltering;
      button.setAttribute("data-active", active ? "true" : "false");
    });
  }

  function ensureHomeButton() {
    if (!isTop || isShellPage()) {
      return;
    }
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("data-blackhole", "home");
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      top: "16px",
      right: "0",
      zIndex: "2147483646",
      pointerEvents: "none",
    });

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          pointer-events: auto;
          display: flex;
          justify-content: flex-end;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        .panel {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          margin: 0;
          padding: 12px 12px 12px 14px;
          border: 1px solid rgba(214, 196, 168, 0.18);
          border-right: none;
          border-radius: 16px 0 0 16px;
          background: rgba(6, 7, 11, 0.88);
          color: #d6c4a8;
          transform: translateX(calc(100% - 28px));
          opacity: 0.72;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition:
            transform 160ms cubic-bezier(0.2, 0, 0, 1),
            opacity 160ms cubic-bezier(0.2, 0, 0, 1),
            background-color 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .wrap[data-open="true"] .panel,
        .panel:focus-within {
          transform: translateX(0);
          opacity: 1;
          background: rgba(14, 16, 22, 0.96);
        }
        .home {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          padding: 4px 4px 8px;
          border: none;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .home:focus-visible,
        .level:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 2px #7eb8c9;
          border-radius: 10px;
        }
        .home:active {
          transform: scale(0.96);
        }
        .glyph {
          width: 18px;
          height: 18px;
          flex: 0 0 auto;
          display: block;
        }
        .label {
          font-size: 14px;
          font-weight: 560;
          letter-spacing: -0.02em;
          white-space: nowrap;
          padding-right: 4px;
        }
        .levels {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .level {
          margin: 0;
          padding: 8px 10px;
          border: 1px solid rgba(214, 196, 168, 0.12);
          border-radius: 10px;
          background: rgba(6, 7, 11, 0.55);
          color: #6e6a78;
          font-size: 12px;
          font-weight: 560;
          cursor: pointer;
        }
        .level[data-active="true"] {
          color: #d6c4a8;
          background: rgba(126, 184, 201, 0.18);
          border-color: rgba(126, 184, 201, 0.35);
        }
        @media (prefers-reduced-motion: reduce) {
          .panel { transition: none; }
        }
      </style>
      <div class="wrap">
        <div class="panel">
          <button class="home" type="button" title="Back to Blackhole (Esc)" aria-label="Back to Blackhole">
            <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="#7eb8c9" stroke-width="1.6"/>
              <circle cx="12" cy="12" r="3.2" fill="#d6c4a8"/>
            </svg>
            <span class="label">Blackhole</span>
          </button>
          <div class="levels" role="group" aria-label="Ad block level">
            ${FILTERING_LEVELS.map(
              (item) =>
                `<button class="level" type="button" data-level="${item.id}">${item.label}</button>`,
            ).join("")}
          </div>
        </div>
      </div>
    `;

    const wrap = shadow.querySelector(".wrap");
    const home = shadow.querySelector(".home");
    let hideTimer = null;

    const open = () => {
      wrap.dataset.open = "true";
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const scheduleClose = () => {
      hideTimer = window.setTimeout(() => {
        wrap.dataset.open = "false";
      }, 1600);
    };

    home.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goHome();
    });
    wrap.addEventListener("mouseenter", open);
    wrap.addEventListener("mouseleave", scheduleClose);
    home.addEventListener("focus", open);
    home.addEventListener("blur", scheduleClose);

    shadow.querySelectorAll("[data-level]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const level = button.getAttribute("data-level");
        if (level) {
          setFiltering(level);
          open();
          scheduleClose();
        }
      });
      button.addEventListener("focus", open);
      button.addEventListener("blur", scheduleClose);
    });

    open();
    scheduleClose();
    document.documentElement.appendChild(host);
    homeBtn = host;
    updateFilteringUi();
    syncSettings();
  }

  function watchDom() {
    if (!isTop || isShellPage() || observer) {
      return;
    }
    observer = new MutationObserver(() => {
      if (!document.getElementById(ROOT_ID)) {
        homeBtn = null;
        ensureHomeButton();
      }
      if (document.body && !document.body.dataset.bhZoomApplied) {
        syncSettings();
        document.body.dataset.bhZoomApplied = "1";
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function onKeyDown(event) {
    const key = event.key;
    const code = event.code;
    const isHome =
      key === "Home" ||
      key === "BrowserHome" ||
      key === "GoHome" ||
      code === "Home";
    const isBack =
      key === "Escape" ||
      key === "BrowserBack" ||
      code === "Escape" ||
      key === "F1";

    if (!isHome && !isBack) {
      return;
    }

    if (isBack && isShellPage()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    goHome();
  }

  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  function pingActivity() {
    if (!isTop) {
      return;
    }
    const now = Date.now();
    if (now - lastActivityPing < 5000) {
      return;
    }
    lastActivityPing = now;
    fetch("http://127.0.0.1:8081/power", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activity" }),
    }).catch(() => {
      /* daemon offline */
    });
  }

  window.addEventListener("keydown", pingActivity, true);
  window.addEventListener("pointerdown", pingActivity, true);
  window.addEventListener("pointermove", pingActivity, { capture: true, passive: true });

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== "blackhole-shell") {
      return;
    }
    if (data.type === "navigate" && typeof data.url === "string") {
      navigate(data.url);
    }
    if (data.type === "go-home") {
      goHome();
    }
  });

  async function pollLaunch() {
    if (!isTop || !isShellPage()) {
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:8081/launch");
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (payload.pending && payload.url) {
        await fetch("http://127.0.0.1:8081/launch/ack", { method: "POST" });
        navigate(payload.url);
      }
    } catch {
      /* daemon offline */
    }
  }

  function bootUi() {
    ensureHomeButton();
    watchDom();
    syncSettings();
  }

  if (isTop && !isShellPage()) {
    if (document.documentElement) {
      bootUi();
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootUi, { once: true });
    }
    let tries = 0;
    const keepAlive = window.setInterval(() => {
      ensureHomeButton();
      syncSettings();
      tries += 1;
      if (tries > 40) {
        window.clearInterval(keepAlive);
      }
    }, 500);
  }

  if (isTop && isShellPage()) {
    window.setInterval(pollLaunch, 1500);
    void pollLaunch();
  }
})();
