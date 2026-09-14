(function blackholeKioskBridge() {
  const SHELL_HINTS = ["127.0.0.1", "localhost"];

  function isShellPage() {
    try {
      const host = window.location.hostname;
      return SHELL_HINTS.includes(host);
    } catch {
      return false;
    }
  }

  function goHome() {
    chrome.runtime.sendMessage({ type: "go-home" });
  }

  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key;
      const isHome = key === "Home" || key === "BrowserHome" || key === "GoHome";
      const isBack = key === "Escape" || key === "BrowserBack";

      if (!isHome && !isBack) {
        return;
      }

      // On the shell itself, Escape should not reload; Home still recenters.
      if (isBack && isShellPage()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      goHome();
    },
    true,
  );

  // Expose a tiny hook for blackholed / shell to request navigation.
  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== "blackhole-shell") {
      return;
    }
    if (data.type === "navigate" && typeof data.url === "string") {
      chrome.runtime.sendMessage({ type: "navigate", url: data.url });
    }
    if (data.type === "go-home") {
      goHome();
    }
  });
})();
