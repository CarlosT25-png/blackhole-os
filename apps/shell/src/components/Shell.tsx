"use client";

import {
  FocusContext,
  init,
  setFocus,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AppRecord, type SystemInfo, type UpdateStatus } from "@/lib/api";
import SettingsView from "@/components/SettingsView";
import { applyDisplay } from "@/lib/display";

init({
  debug: false,
  visualDebug: false,
});

type View = "home" | "store" | "settings";

type Toast = { message: string; kind?: "info" | "error" } | null;

const STORE_PAGE_SIZE = 8;
const DRAG_THRESHOLD_PX = 14;

function ShiftIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {dir === "left" ? (
        <path
          d="M14.5 6.5 9 12l5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M9.5 6.5 15 12l-5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function moveApp(apps: AppRecord[], id: string, toIndex: number): AppRecord[] {
  const from = apps.findIndex((app) => app.id === id);
  if (from < 0) return apps;
  const clamped = Math.max(0, Math.min(toIndex, apps.length - 1));
  if (from === clamped) return apps;
  const next = [...apps];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

function matchesQuery(app: AppRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [app.name, app.description, app.category].some((value) =>
    (value ?? "").toLowerCase().includes(q),
  );
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 2.75v8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7.05 6.2a8 8 0 1 0 9.9 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M15.2 3.6a8.4 8.4 0 1 0 5.1 13.1 6.9 6.9 0 0 1-5.1-13.1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Clock({ timezone, hour12 }: { timezone?: string; hour12?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [timezone, hour12]);
  if (!now) {
    return <span className="clock" aria-hidden="true">--:--</span>;
  }
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12 ?? true,
  };
  let label = now.toLocaleTimeString([], options);
  try {
    label = now.toLocaleTimeString(
      [],
      timezone ? { ...options, timeZone: timezone } : options,
    );
  } catch {
    /* invalid timezone */
  }
  return (
    <time className="clock" dateTime={now.toISOString()}>
      {label}
    </time>
  );
}

function Focusable({
  focusKey,
  className,
  onEnterPress,
  onEnterRelease,
  onArrowPress,
  onFocus,
  onBlur,
  clickToEnter = true,
  children,
  as: Tag = "button",
  ...rest
}: {
  focusKey: string;
  className?: string;
  onEnterPress?: () => void;
  onEnterRelease?: () => void;
  onArrowPress?: (direction: string) => boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  clickToEnter?: boolean;
  children: React.ReactNode;
  as?: "button" | "div";
  [key: string]: unknown;
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress,
    onEnterRelease,
    onArrowPress,
    onFocus,
    onBlur,
  });

  return (
    <Tag
      ref={ref as never}
      className={className}
      data-focused={focused ? "true" : "false"}
      type={Tag === "button" ? "button" : undefined}
      onClick={() => {
        if (clickToEnter) onEnterPress?.();
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

function AppTile({
  app,
  focusKey,
  onOpen,
  onFocus,
  store,
}: {
  app: AppRecord;
  focusKey: string;
  onOpen: () => void;
  onFocus: () => void;
  store?: boolean;
}) {
  return (
    <Focusable
      focusKey={focusKey}
      className={`tile${store ? " store-tile" : ""}`}
      onEnterPress={onOpen}
      onFocus={onFocus}
    >
      <div className="tile-face">
        {app.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.icon} alt="" />
        ) : (
          <span className="tile-glyph">{store ? "+" : app.name.slice(0, 1)}</span>
        )}
      </div>
      <span className="tile-label">{app.name}</span>
    </Focusable>
  );
}

function HomeAppTile({
  app,
  index,
  count,
  arranging,
  lifting,
  onLaunch,
  onToggleLift,
  onNudge,
  onDragTo,
  onDragEnd,
}: {
  app: AppRecord;
  index: number;
  count: number;
  arranging: boolean;
  lifting: boolean;
  onLaunch: () => void;
  onToggleLift: () => void;
  onNudge: (delta: number) => void;
  onDragTo: (clientX: number) => void;
  onDragEnd: () => void;
}) {
  const dragging = useRef(false);
  const ignoreClick = useRef(false);
  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const arrangingRef = useRef(arranging);
  const liftingRef = useRef(lifting);
  arrangingRef.current = arranging;
  liftingRef.current = lifting;

  const { ref, focused } = useFocusable({
    focusKey: `HOME_APP_${app.id}`,
    onEnterPress: () => {
      ignoreClick.current = true;
      window.setTimeout(() => {
        ignoreClick.current = false;
      }, 280);
      if (arrangingRef.current) onToggleLift();
      else onLaunch();
    },
    onArrowPress: (direction) => {
      if (!arrangingRef.current || !liftingRef.current) return true;
      if (direction === "left") onNudge(-1);
      if (direction === "right") onNudge(1);
      return false;
    },
  });

  const showShift = arranging && lifting;
  const canShiftLeft = index > 0;
  const canShiftRight = index < count - 1;

  return (
    <div className="shelf-item" data-lifting={lifting ? "true" : "false"}>
      {showShift && canShiftLeft ? (
        <button
          type="button"
          className="tile-shift tile-shift-left"
          tabIndex={-1}
          aria-label={`Move ${app.name} left`}
          onClick={(event) => {
            event.stopPropagation();
            onNudge(-1);
          }}
        >
          <ShiftIcon dir="left" />
        </button>
      ) : null}
      <button
        ref={ref as never}
        className="tile"
        type="button"
        data-focused={focused ? "true" : "false"}
        data-moving={lifting ? "true" : "false"}
        data-app-id={app.id}
        aria-grabbed={lifting}
        onClick={() => {
          if (ignoreClick.current) return;
          if (arrangingRef.current) onToggleLift();
          else onLaunch();
        }}
        onPointerDown={(event) => {
          if (!arrangingRef.current || event.button !== 0) return;
          pointerId.current = event.pointerId;
          startX.current = event.clientX;
          dragging.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!arrangingRef.current || pointerId.current !== event.pointerId) return;
          const dx = event.clientX - startX.current;
          if (!dragging.current && Math.abs(dx) > DRAG_THRESHOLD_PX) {
            dragging.current = true;
            if (!liftingRef.current) onToggleLift();
          }
          if (dragging.current) onDragTo(event.clientX);
        }}
        onPointerUp={(event) => {
          if (pointerId.current !== event.pointerId) return;
          pointerId.current = null;
          const wasDragging = dragging.current;
          dragging.current = false;
          if (wasDragging) {
            const suppress = (clickEvent: Event) => {
              clickEvent.preventDefault();
              clickEvent.stopPropagation();
            };
            window.addEventListener("click", suppress, true);
            window.setTimeout(() => window.removeEventListener("click", suppress, true), 400);
            onDragEnd();
          }
        }}
        onPointerCancel={() => {
          pointerId.current = null;
          dragging.current = false;
        }}
      >
        <div className="tile-face">
          {arranging ? <span className="tile-index">{index + 1}</span> : null}
          {app.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={app.icon} alt="" draggable={false} />
          ) : (
            <span className="tile-glyph">{app.name.slice(0, 1)}</span>
          )}
        </div>
        <span className="tile-label">{app.name}</span>
      </button>
      {showShift && canShiftRight ? (
        <button
          type="button"
          className="tile-shift tile-shift-right"
          tabIndex={-1}
          aria-label={`Move ${app.name} right`}
          onClick={(event) => {
            event.stopPropagation();
            onNudge(1);
          }}
        >
          <ShiftIcon dir="right" />
        </button>
      ) : null}
    </div>
  );
}

function SideloadDialog({
  url,
  onUrlChange,
  onAdd,
  onClose,
}: {
  url: string;
  onUrlChange: (value: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const { ref, focusKey } = useFocusable({
    focusKey: "STORE_DIALOG",
    trackChildren: true,
    isFocusBoundary: true,
  });

  useEffect(() => {
    const id = window.setTimeout(() => {
      setFocus("STORE_URL");
      document.getElementById("sideload")?.focus();
    }, 40);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className="modal-backdrop"
        onClick={onClose}
        role="presentation"
      >
        <div
          ref={ref as never}
          className="modal-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sideload-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="sideload-title" className="panel-title">
            Add from URL
          </h3>
          <p className="panel-copy">Paste a site or manifest if it is not in the catalog.</p>
          <div className="url-form">
            <Focusable
              as="div"
              focusKey="STORE_URL"
              className="store-field store-field-bare"
              onEnterPress={() => {
                const input = document.getElementById("sideload") as HTMLInputElement | null;
                input?.focus();
              }}
            >
              <input
                id="sideload"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://example.com or manifest URL"
                aria-label="App URL"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAdd();
                  }
                }}
              />
            </Focusable>
          </div>
          <div className="modal-actions">
            <Focusable
              focusKey="STORE_CANCEL"
              className="ghost-btn"
              onEnterPress={onClose}
            >
              Cancel
            </Focusable>
            <Focusable
              focusKey="STORE_ADD"
              className="primary-btn"
              onEnterPress={onAdd}
            >
              Add
            </Focusable>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

function PowerMenu({
  open,
  busy,
  onToggle,
  onClose,
  onSleep,
  onPowerOff,
}: {
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSleep: () => void;
  onPowerOff: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { ref, focusKey } = useFocusable({
    focusKey: "TOP_POWER_MENU",
    trackChildren: true,
  });

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setFocus("TOP_POWER_SLEEP"), 40);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="power-menu" ref={rootRef}>
        <div ref={ref as never}>
          <Focusable
            focusKey="TOP_POWER"
            className="topbar-power"
            aria-label="Power"
            aria-haspopup="menu"
            aria-expanded={open}
            onEnterPress={() => {
              if (!busy) onToggle();
            }}
          >
            <PowerIcon />
          </Focusable>
          {open ? (
            <div className="power-menu-panel" role="menu" aria-label="Power options">
              <Focusable
                focusKey="TOP_POWER_SLEEP"
                className="power-menu-item"
                role="menuitem"
                onEnterPress={() => {
                  if (busy) return;
                  onClose();
                  onSleep();
                }}
              >
                <MoonIcon />
                Sleep
              </Focusable>
              <Focusable
                focusKey="TOP_POWER_OFF"
                className="power-menu-item"
                role="menuitem"
                onEnterPress={() => {
                  if (busy) return;
                  onClose();
                  onPowerOff();
                }}
              >
                <PowerIcon />
                Power off
              </Focusable>
            </div>
          ) : null}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

function PowerOffDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { ref, focusKey } = useFocusable({
    focusKey: "TOP_POWER_DIALOG",
    trackChildren: true,
    isFocusBoundary: true,
  });

  useEffect(() => {
    const id = window.setTimeout(() => setFocus("TOP_POWER_CANCEL"), 40);
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
          aria-labelledby="top-power-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 id="top-power-title" className="panel-title">
            Power off?
          </h3>
          <p className="panel-copy">
            This TV will shut down. Use the power button on the device to turn it back on.
          </p>
          <div className="modal-actions">
            <Focusable
              focusKey="TOP_POWER_CANCEL"
              className="ghost-btn"
              onEnterPress={() => {
                if (!busy) onClose();
              }}
            >
              Cancel
            </Focusable>
            <Focusable
              focusKey="TOP_POWER_CONFIRM"
              className="primary-btn"
              onEnterPress={() => {
                if (!busy) onConfirm();
              }}
            >
              {busy ? "Powering off…" : "Power off"}
            </Focusable>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default function Shell() {
  const [view, setView] = useState<View>("home");
  const [installed, setInstalled] = useState<AppRecord[]>([]);
  const [catalog, setCatalog] = useState<AppRecord[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [sideloadUrl, setSideloadUrl] = useState("");
  const [sideloadOpen, setSideloadOpen] = useState(false);
  const [powerMenuOpen, setPowerMenuOpen] = useState(false);
  const [powerConfirm, setPowerConfirm] = useState(false);
  const [powerBusy, setPowerBusy] = useState(false);
  const [storeQuery, setStoreQuery] = useState("");
  const [storePage, setStorePage] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const shelfRef = useRef<HTMLDivElement>(null);
  const installedRef = useRef<AppRecord[]>([]);
  const snapshotRef = useRef<AppRecord[] | null>(null);
  const arrangingRef = useRef(false);
  const sideloadOpenRef = useRef(false);
  const powerMenuOpenRef = useRef(false);
  const powerConfirmRef = useRef(false);
  const powerBusyRef = useRef(false);
  installedRef.current = installed;
  arrangingRef.current = arranging;
  sideloadOpenRef.current = sideloadOpen;
  powerMenuOpenRef.current = powerMenuOpen;
  powerConfirmRef.current = powerConfirm;
  powerBusyRef.current = powerBusy;

  const { ref, focusKey } = useFocusable({
    focusKey: "SHELL_ROOT",
    trackChildren: true,
    isFocusBoundary: true,
  });

  const showToast = useCallback((message: string, kind: "info" | "error" = "info") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const runPower = useCallback(
    async (action: "sleep" | "poweroff") => {
      setPowerBusy(true);
      try {
        const res = await api.powerAction(action);
        if (res.power) {
          setSystem((prev) => (prev ? { ...prev, power: res.power } : prev));
        }
        showToast(res.message || (action === "sleep" ? "Sleeping" : "Powering off"));
        if (action === "poweroff") setPowerConfirm(false);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Power action failed", "error");
      } finally {
        setPowerBusy(false);
      }
    },
    [showToast],
  );

  const refresh = useCallback(async () => {
    try {
      const [appsRes, catalogRes, systemRes, updateRes] = await Promise.all([
        api.apps(),
        api.catalog(),
        api.system(),
        api.update(),
      ]);
      setInstalled(appsRes.apps);
      setCatalog(catalogRes.apps);
      setSystem(systemRes);
      setUpdate(updateRes);
      if (systemRes.display) {
        applyDisplay(systemRes.display);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not reach blackholed", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      void api.powerAction("activity").catch(() => undefined);
    };
    window.addEventListener("keydown", ping, true);
    window.addEventListener("pointerdown", ping, { capture: true, passive: true });
    window.addEventListener("pointermove", ping, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", ping, true);
      window.removeEventListener("pointerdown", ping, true);
      window.removeEventListener("pointermove", ping, true);
    };
  }, []);

  useEffect(() => {
    const preferred =
      view === "home"
        ? installed.length
          ? `HOME_APP_${installed[0].id}`
          : "HOME_STORE"
        : view === "store"
          ? "STORE_SEARCH"
          : "SET_NAV_ABOUT";
    const id = window.setTimeout(() => setFocus(preferred), 40);
    return () => window.clearTimeout(id);
  }, [view, installed.length]);

  const installedIds = useMemo(() => new Set(installed.map((a) => a.id)), [installed]);

  const filteredCatalog = useMemo(
    () => catalog.filter((app) => matchesQuery(app, storeQuery)),
    [catalog, storeQuery],
  );

  const storePageCount = Math.max(1, Math.ceil(filteredCatalog.length / STORE_PAGE_SIZE));
  const activeStorePage = Math.min(storePage, storePageCount - 1);
  const pagedCatalog = filteredCatalog.slice(
    activeStorePage * STORE_PAGE_SIZE,
    (activeStorePage + 1) * STORE_PAGE_SIZE,
  );

  const goStorePage = (next: number) => {
    const clamped = Math.max(0, Math.min(next, storePageCount - 1));
    setStorePage(clamped);
    window.setTimeout(() => {
      setFocus(filteredCatalog.length ? "STORE_APP_0" : "STORE_SEARCH");
    }, 80);
  };

  const closeSideload = useCallback(() => {
    setSideloadOpen(false);
    window.setTimeout(() => setFocus("STORE_SIDELOAD"), 40);
  }, []);

  const openSideload = useCallback(() => {
    setSideloadOpen(true);
  }, []);

  const go = (next: View) => setView(next);

  const startArrange = useCallback(() => {
    if (installedRef.current.length < 2) return;
    snapshotRef.current = installedRef.current;
    setArranging(true);
    setMovingId(null);
    const first = installedRef.current[0];
    window.setTimeout(() => {
      if (first) setFocus(`HOME_APP_${first.id}`);
    }, 40);
  }, []);

  const finishArrange = useCallback(
    async (save: boolean) => {
      const ids = installedRef.current.map((app) => app.id);
      const original = snapshotRef.current?.map((app) => app.id) ?? ids;
      const previous = snapshotRef.current;
      snapshotRef.current = null;
      setMovingId(null);
      setArranging(false);
      if (!save) {
        if (previous) setInstalled(previous);
        return;
      }
      if (ids.join("\0") === original.join("\0")) return;
      try {
        const res = await api.reorder(ids);
        setInstalled(res.apps);
      } catch (err) {
        if (previous) setInstalled(previous);
        showToast(err instanceof Error ? err.message : "Could not save order", "error");
      }
    },
    [showToast],
  );

  const toggleLift = useCallback((id: string) => {
    setMovingId((current) => (current === id ? null : id));
  }, []);

  const nudgeApp = useCallback((id: string, delta: number) => {
    setMovingId(id);
    setInstalled((prev) => {
      const from = prev.findIndex((app) => app.id === id);
      if (from < 0) return prev;
      return moveApp(prev, id, from + delta);
    });
  }, []);

  const dragAppTo = useCallback((id: string, clientX: number) => {
    const nodes = shelfRef.current?.querySelectorAll<HTMLElement>("[data-app-id]");
    if (!nodes?.length) return;
    let nextIndex = nodes.length - 1;
    for (let i = 0; i < nodes.length; i += 1) {
      const rect = nodes[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        nextIndex = i;
        break;
      }
    }
    setInstalled((prev) => moveApp(prev, id, nextIndex));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (arrangingRef.current) {
        event.preventDefault();
        void finishArrange(false);
        return;
      }
      if (powerConfirmRef.current) {
        event.preventDefault();
        if (!powerBusyRef.current) setPowerConfirm(false);
        return;
      }
      if (powerMenuOpenRef.current) {
        event.preventDefault();
        setPowerMenuOpen(false);
        setFocus("TOP_POWER");
        return;
      }
      if (sideloadOpenRef.current) {
        event.preventDefault();
        closeSideload();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSideload, finishArrange]);

  useEffect(() => {
    if (view !== "store") setSideloadOpen(false);
  }, [view]);

  useEffect(() => {
    if (view !== "home" && arrangingRef.current) {
      void finishArrange(true);
    }
  }, [view, finishArrange]);

  const launch = async (id: string) => {
    try {
      const res = await api.launch(id);
      showToast(`Opening ${res.url}`);
      // Ask the kiosk-bridge extension (when loaded) to navigate the tab.
      window.postMessage(
        { source: "blackhole-shell", type: "navigate", url: res.url },
        "*",
      );
      // Always navigate this window — works in plain browser and in kiosk.
      window.setTimeout(() => {
        window.location.assign(res.url);
      }, 80);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Launch failed", "error");
    }
  };

  const installCatalog = async (app: AppRecord) => {
    try {
      const res = await api.install(`catalog:${app.id}`);
      setInstalled(res.apps);
      showToast(`${app.name} installed`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Install failed", "error");
    }
  };

  const uninstall = async (id: string) => {
    try {
      const res = await api.uninstall(id);
      setInstalled(res.apps);
      showToast("App removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Remove failed", "error");
    }
  };

  const installUrl = async () => {
    const value = sideloadUrl.trim();
    if (!value) {
      showToast("Enter a URL", "error");
      return;
    }
    try {
      const res = await api.install(value);
      setInstalled(res.apps);
      setSideloadUrl("");
      setSideloadOpen(false);
      showToast(`${res.app.name} installed`);
      setView("home");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Install failed", "error");
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="app-root" ref={ref}>
        <header className="topbar">
          <h1 className="wordmark">Blackhole</h1>
          <div className="topbar-tools">
            <Clock timezone={system?.time?.timezone} hour12={system?.time?.hour12} />
            <PowerMenu
              open={powerMenuOpen}
              busy={powerBusy}
              onToggle={() => setPowerMenuOpen((prev) => !prev)}
              onClose={() => setPowerMenuOpen(false)}
              onSleep={() => void runPower("sleep")}
              onPowerOff={() => setPowerConfirm(true)}
            />
          </div>
        </header>

        <nav className="nav-row" aria-label="Main">
          {(
            [
              ["home", "Home"],
              ["store", "Store"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <Focusable
              key={id}
              focusKey={`NAV_${id.toUpperCase()}`}
              className="nav-pill"
              data-active={view === id ? "true" : "false"}
              onEnterPress={() => go(id)}
            >
              {label}
            </Focusable>
          ))}
        </nav>

        {view === "home" && (
          <section className="home-view">
            <div className="home-head">
              <div>
                <h2 className="view-title">{arranging ? "Rearrange" : "Your apps"}</h2>
                <p className="view-lede">
                  {loading
                    ? "Loading…"
                    : installed.length === 0
                      ? "Install an app from the store."
                      : arranging
                        ? movingId
                          ? "Slide with left and right, then press OK. Done saves."
                          : "Focus an app, press OK, then slide it into place."
                        : installed.length > 1
                          ? "Open an app, or arrange the shelf."
                          : "Open an app, or move to the store at the end of the shelf."}
                </p>
              </div>
              {installed.length > 1 ? (
                <div className="home-actions">
                  {arranging ? (
                    <>
                      <Focusable
                        focusKey="HOME_ARRANGE_CANCEL"
                        className="ghost-btn"
                        onEnterPress={() => {
                          void finishArrange(false);
                          window.setTimeout(() => setFocus("HOME_ARRANGE"), 40);
                        }}
                      >
                        Cancel
                      </Focusable>
                      <Focusable
                        focusKey="HOME_ARRANGE_DONE"
                        className="primary-btn home-done"
                        onEnterPress={() => {
                          void finishArrange(true);
                          window.setTimeout(() => setFocus("HOME_ARRANGE"), 40);
                        }}
                      >
                        Done
                      </Focusable>
                    </>
                  ) : (
                    <Focusable
                      focusKey="HOME_ARRANGE"
                      className="ghost-btn"
                      onEnterPress={startArrange}
                    >
                      Arrange
                    </Focusable>
                  )}
                </div>
              ) : null}
            </div>
            <div
              className="shelf"
              role="list"
              ref={shelfRef}
              data-arranging={arranging ? "true" : "false"}
            >
              {installed.map((app, index) => (
                <div key={app.id} role="listitem">
                  <HomeAppTile
                    app={app}
                    index={index}
                    count={installed.length}
                    arranging={arranging}
                    lifting={movingId === app.id}
                    onLaunch={() => void launch(app.id)}
                    onToggleLift={() => toggleLift(app.id)}
                    onNudge={(delta) => nudgeApp(app.id, delta)}
                    onDragTo={(clientX) => dragAppTo(app.id, clientX)}
                    onDragEnd={() => undefined}
                  />
                </div>
              ))}
              {arranging ? null : (
                <div role="listitem">
                  <AppTile
                    store
                    app={{
                      id: "store",
                      name: "Store",
                      startUrl: "#store",
                      icon: null,
                    }}
                    focusKey="HOME_STORE"
                    onOpen={() => go("store")}
                    onFocus={() => undefined}
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {view === "store" && (
          <section className="store-view">
            <div className="store-head">
              <div>
                <h2 className="view-title">Store</h2>
                <p className="view-lede">Find a PWA, or add any site from a URL.</p>
              </div>
              <Focusable
                focusKey="STORE_SIDELOAD"
                className="store-add-btn"
                onEnterPress={openSideload}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                Add from URL
              </Focusable>
            </div>

            <Focusable
              as="div"
              focusKey="STORE_SEARCH"
              className="store-field"
              onEnterPress={() => {
                const input = document.getElementById("store-search") as HTMLInputElement | null;
                input?.focus();
              }}
            >
              <svg className="store-field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                id="store-search"
                value={storeQuery}
                onChange={(e) => {
                  setStoreQuery(e.target.value);
                  setStorePage(0);
                }}
                placeholder="Search the catalog"
                aria-label="Search the catalog"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </Focusable>

            {filteredCatalog.length === 0 ? (
              <div className="store-empty">
                <p>
                  {catalog.length === 0
                    ? loading
                      ? "Loading the catalog…"
                      : "The catalog is empty."
                    : "No apps match that search."}
                </p>
                {storeQuery.trim() ? (
                  <Focusable
                    focusKey="STORE_CLEAR"
                    className="primary-btn"
                    onEnterPress={() => {
                      setStoreQuery("");
                      setStorePage(0);
                      window.setTimeout(() => setFocus("STORE_SEARCH"), 40);
                    }}
                  >
                    Show all
                  </Focusable>
                ) : null}
              </div>
            ) : (
              <>
                <div className="catalog-grid">
                  {pagedCatalog.map((app, index) => {
                    const isInstalled = installedIds.has(app.id);
                    return (
                      <Focusable
                        key={app.id}
                        focusKey={`STORE_APP_${index}`}
                        className="catalog-card"
                        data-installed={isInstalled ? "true" : "false"}
                        onEnterPress={() =>
                          void (isInstalled ? uninstall(app.id) : installCatalog(app))
                        }
                      >
                        <div className="catalog-card-face">
                          {app.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={app.icon} alt="" />
                          ) : (
                            <span className="tile-glyph">{app.name.slice(0, 1)}</span>
                          )}
                        </div>
                        <div className="catalog-card-body">
                          {app.category ? (
                            <span className="catalog-card-category">{app.category}</span>
                          ) : null}
                          <strong>{app.name}</strong>
                          {app.description ? <span>{app.description}</span> : null}
                        </div>
                        <span className="catalog-card-action">
                          {isInstalled ? "Remove" : "Install"}
                        </span>
                      </Focusable>
                    );
                  })}
                </div>

                <div className="pager" aria-label="Catalog pages">
                  {activeStorePage > 0 ? (
                    <Focusable
                      focusKey="STORE_PREV"
                      className="pager-btn"
                      onEnterPress={() => goStorePage(activeStorePage - 1)}
                    >
                      Previous
                    </Focusable>
                  ) : (
                    <span className="pager-btn" data-disabled="true" aria-hidden="true">
                      Previous
                    </span>
                  )}
                  <p className="pager-status">
                    Page {activeStorePage + 1} of {storePageCount}
                    <span>
                      {filteredCatalog.length}{" "}
                      {filteredCatalog.length === 1 ? "app" : "apps"}
                      {storeQuery.trim() ? " found" : ""}
                    </span>
                  </p>
                  {activeStorePage < storePageCount - 1 ? (
                    <Focusable
                      focusKey="STORE_NEXT"
                      className="pager-btn"
                      onEnterPress={() => goStorePage(activeStorePage + 1)}
                    >
                      Next
                    </Focusable>
                  ) : (
                    <span className="pager-btn" data-disabled="true" aria-hidden="true">
                      Next
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {sideloadOpen ? (
          <SideloadDialog
            url={sideloadUrl}
            onUrlChange={setSideloadUrl}
            onAdd={() => void installUrl()}
            onClose={closeSideload}
          />
        ) : null}

        {powerConfirm ? (
          <PowerOffDialog
            busy={powerBusy}
            onClose={() => {
              if (!powerBusy) setPowerConfirm(false);
            }}
            onConfirm={() => void runPower("poweroff")}
          />
        ) : null}

        {view === "settings" && (
          <SettingsView
            Focusable={Focusable}
            system={system}
            update={update}
            onUpdateChange={setUpdate}
            onSystemChange={(next) => setSystem(next)}
            showToast={showToast}
          />
        )}
        {toast && (
          <div className="toast" data-kind={toast.kind || "info"} role="status">
            {toast.message}
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
}
