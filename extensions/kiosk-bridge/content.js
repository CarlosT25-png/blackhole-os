(function blackholeKioskBridge() {
  const SHELL_HINTS = ["127.0.0.1", "localhost"];
  const SHELL_FALLBACKS = [
    "http://127.0.0.1:3000/",
    "http://127.0.0.1/",
    "http://localhost:3000/",
  ];
  const ROOT_ID = "blackhole-home-root";
  const isTop = window === window.top;
  let lastHandledUrl = null;
  let homeBtn = null;
  let observer = null;

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
        .hit {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          padding: 11px 14px 11px 16px;
          border: 1px solid rgba(214, 196, 168, 0.18);
          border-right: none;
          border-radius: 16px 0 0 16px;
          background: rgba(6, 7, 11, 0.82);
          color: #d6c4a8;
          cursor: pointer;
          transform: translateX(calc(100% - 26px));
          opacity: 0.7;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition:
            transform 160ms cubic-bezier(0.2, 0, 0, 1),
            opacity 160ms cubic-bezier(0.2, 0, 0, 1),
            background-color 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .hit:hover,
        .hit:focus-visible,
        .wrap[data-open="true"] .hit {
          transform: translateX(0);
          opacity: 1;
          background: rgba(14, 16, 22, 0.95);
          outline: none;
        }
        .hit:focus-visible {
          box-shadow: inset 0 0 0 2px #7eb8c9;
        }
        .hit:active {
          transform: translateX(0) scale(0.96);
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
        @media (prefers-reduced-motion: reduce) {
          .hit { transition: none; }
        }
      </style>
      <div class="wrap">
        <button class="hit" type="button" title="Back to Blackhole (Esc)" aria-label="Back to Blackhole">
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="#7eb8c9" stroke-width="1.6"/>
            <circle cx="12" cy="12" r="3.2" fill="#d6c4a8"/>
          </svg>
          <span class="label">Blackhole</span>
        </button>
      </div>
    `;

    const wrap = shadow.querySelector(".wrap");
    const button = shadow.querySelector(".hit");
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
      }, 1400);
    };

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goHome();
    });
    wrap.addEventListener("mouseenter", open);
    wrap.addEventListener("mouseleave", scheduleClose);
    button.addEventListener("focus", open);
    button.addEventListener("blur", scheduleClose);

    open();
    scheduleClose();

    // Prefer <html> — many SPAs wipe <body> children.
    document.documentElement.appendChild(host);
    homeBtn = host;
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

  // Capture as early as possible in every frame (Peacock traps Esc in iframes).
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keydown", onKeyDown, true);

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
  }

  if (isTop && !isShellPage()) {
    if (document.documentElement) {
      bootUi();
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootUi, { once: true });
    }
    // SPAs remount late; keep trying briefly.
    let tries = 0;
    const keepAlive = window.setInterval(() => {
      ensureHomeButton();
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
