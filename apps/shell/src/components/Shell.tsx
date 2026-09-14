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

init({
  debug: false,
  visualDebug: false,
});

type View = "home" | "store" | "settings";

type Toast = { message: string; kind?: "info" | "error" } | null;

const STORE_PAGE_SIZE = 8;
const HOLD_TO_MOVE_MS = 450;
const DRAG_THRESHOLD_PX = 14;

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

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) {
    return <span className="clock" aria-hidden="true">--:--</span>;
  }
  return (
    <time className="clock" dateTime={now.toISOString()}>
      {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
  moving,
  canMove,
  onLaunch,
  onPickUp,
  onDrop,
  onNudge,
  onDragTo,
  onDragEnd,
}: {
  app: AppRecord;
  moving: boolean;
  canMove: boolean;
  onLaunch: () => void;
  onPickUp: () => void;
  onDrop: () => void;
  onNudge: (delta: number) => void;
  onDragTo: (clientX: number) => void;
  onDragEnd: () => void;
}) {
  const holdTimer = useRef<number | null>(null);
  const armed = useRef(false);
  const didHold = useRef(false);
  const dragging = useRef(false);
  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const movingRef = useRef(moving);
  movingRef.current = moving;

  const clearHold = () => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const { ref, focused } = useFocusable({
    focusKey: `HOME_APP_${app.id}`,
    onEnterPress: () => {
      if (movingRef.current) {
        if (armed.current) onDrop();
        return;
      }
      if (!canMove) return;
      if (holdTimer.current != null) return;
      didHold.current = false;
      armed.current = false;
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        didHold.current = true;
        armed.current = false;
        onPickUp();
      }, HOLD_TO_MOVE_MS);
    },
    onEnterRelease: () => {
      const held = didHold.current;
      clearHold();
      if (movingRef.current) {
        armed.current = true;
        return;
      }
      if (!held) onLaunch();
    },
    onArrowPress: (direction) => {
      if (!movingRef.current) return true;
      if (direction === "left") onNudge(-1);
      if (direction === "right") onNudge(1);
      return false;
    },
    onBlur: () => {
      if (!movingRef.current) clearHold();
    },
  });

  return (
    <button
      ref={ref as never}
      className="tile"
      type="button"
      data-focused={focused ? "true" : "false"}
      data-moving={moving ? "true" : "false"}
      data-app-id={app.id}
      aria-grabbed={moving}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointerId.current = event.pointerId;
        startX.current = event.clientX;
        dragging.current = false;
        didHold.current = movingRef.current;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (movingRef.current || !canMove) return;
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          didHold.current = true;
          armed.current = false;
          onPickUp();
        }, HOLD_TO_MOVE_MS);
      }}
      onPointerMove={(event) => {
        if (pointerId.current !== event.pointerId || !canMove) return;
        const dx = event.clientX - startX.current;
        if (!dragging.current && Math.abs(dx) > DRAG_THRESHOLD_PX) {
          dragging.current = true;
          didHold.current = true;
          clearHold();
          onPickUp();
        }
        if (dragging.current) onDragTo(event.clientX);
      }}
      onPointerUp={(event) => {
        if (pointerId.current !== event.pointerId) return;
        pointerId.current = null;
        const wasDragging = dragging.current;
        const held = didHold.current;
        dragging.current = false;
        clearHold();
        if (wasDragging) {
          const suppress = (clickEvent: Event) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
          };
          window.addEventListener("click", suppress, true);
          window.setTimeout(() => window.removeEventListener("click", suppress, true), 400);
          onDragEnd();
          return;
        }
        if (movingRef.current) {
          if (held) {
            armed.current = true;
            return;
          }
          onDrop();
          return;
        }
        if (!held) onLaunch();
      }}
      onPointerCancel={() => {
        pointerId.current = null;
        dragging.current = false;
        clearHold();
      }}
    >
      <div className="tile-face">
        {canMove ? (
          <span className="tile-grip" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : null}
        {app.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.icon} alt="" draggable={false} />
        ) : (
          <span className="tile-glyph">{app.name.slice(0, 1)}</span>
        )}
      </div>
      <span className="tile-label">{app.name}</span>
    </button>
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
  const [view, setView] = useState<View>("home");
  const [installed, setInstalled] = useState<AppRecord[]>([]);
  const [catalog, setCatalog] = useState<AppRecord[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [sideloadUrl, setSideloadUrl] = useState("");
  const [sideloadOpen, setSideloadOpen] = useState(false);
  const [storeQuery, setStoreQuery] = useState("");
  const [storePage, setStorePage] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const installedRef = useRef<AppRecord[]>([]);
  const snapshotRef = useRef<AppRecord[] | null>(null);
  const movingIdRef = useRef<string | null>(null);
  const sideloadOpenRef = useRef(false);
  installedRef.current = installed;
  movingIdRef.current = movingId;
  sideloadOpenRef.current = sideloadOpen;

  const { ref, focusKey } = useFocusable({
    focusKey: "SHELL_ROOT",
    trackChildren: true,
    isFocusBoundary: true,
  });

  const showToast = useCallback((message: string, kind: "info" | "error" = "info") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

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

  const pickUpApp = useCallback((id: string) => {
    if (installedRef.current.length < 2) return;
    if (!snapshotRef.current) {
      snapshotRef.current = installedRef.current;
    }
    setMovingId(id);
    window.setTimeout(() => setFocus(`HOME_APP_${id}`), 0);
  }, []);

  const commitMove = useCallback(async () => {
    const ids = installedRef.current.map((app) => app.id);
    const original = snapshotRef.current?.map((app) => app.id) ?? ids;
    snapshotRef.current = null;
    setMovingId(null);
    if (ids.join("\0") === original.join("\0")) return;
    try {
      const res = await api.reorder(ids);
      setInstalled(res.apps);
    } catch (err) {
      const previous = original
        .map((id) => installedRef.current.find((app) => app.id === id))
        .filter((app): app is AppRecord => Boolean(app));
      if (previous.length === original.length) setInstalled(previous);
      showToast(err instanceof Error ? err.message : "Could not save order", "error");
    }
  }, [showToast]);

  const cancelMove = useCallback(() => {
    const previous = snapshotRef.current;
    snapshotRef.current = null;
    if (previous) setInstalled(previous);
    setMovingId(null);
  }, []);

  const nudgeApp = useCallback((id: string, delta: number) => {
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
      if (movingIdRef.current) {
        event.preventDefault();
        cancelMove();
        return;
      }
      if (sideloadOpenRef.current) {
        event.preventDefault();
        closeSideload();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelMove, closeSideload]);

  useEffect(() => {
    if (view !== "store") setSideloadOpen(false);
  }, [view]);

  useEffect(() => {
    if (view !== "home" && movingIdRef.current) {
      void commitMove();
    }
  }, [view, commitMove]);

  const launch = async (id: string) => {
    try {
      const res = await api.launch(id);
      showToast(`Opening ${res.url}`);
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
          <Clock />
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
          <section>
            <h2 className="view-title">Your apps</h2>
            <p className="view-lede">
              {loading
                ? "Loading…"
                : installed.length === 0
                  ? "Install an app from the store."
                  : movingId
                    ? "Move left or right, then press OK to place. Esc cancels."
                    : installed.length > 1
                      ? "Open an app, or hold OK and move it to rearrange."
                      : "Open an app, or move to the store at the end of the shelf."}
            </p>
            <div
              className="shelf"
              role="list"
              ref={shelfRef}
              data-arranging={movingId ? "true" : "false"}
            >
              {installed.map((app) => (
                <div key={app.id} role="listitem">
                  <HomeAppTile
                    app={app}
                    moving={movingId === app.id}
                    canMove={installed.length > 1}
                    onLaunch={() => void launch(app.id)}
                    onPickUp={() => pickUpApp(app.id)}
                    onDrop={() => void commitMove()}
                    onNudge={(delta) => nudgeApp(app.id, delta)}
                    onDragTo={(clientX) => dragAppTo(app.id, clientX)}
                    onDragEnd={() => void commitMove()}
                  />
                </div>
              ))}
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
                          <strong>{app.name}</strong>
                          {app.description ? <span>{app.description}</span> : null}
                        </div>
                        <span className="row-action">{isInstalled ? "Remove" : "Install"}</span>
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
