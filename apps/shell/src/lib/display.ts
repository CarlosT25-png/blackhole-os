import type { DisplaySettings } from "@/lib/api";

export function applyDisplay(display: DisplaySettings) {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String((display.scale || 100) / 100));
  root.dataset.reducedMotion = display.reducedMotion ? "true" : "false";
  if (display.aspect && display.aspect !== "auto") {
    root.dataset.aspect = display.aspect;
  } else {
    delete root.dataset.aspect;
  }
}
