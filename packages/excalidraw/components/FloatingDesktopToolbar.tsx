import clsx from "clsx";
import React, { useLayoutEffect, useRef, useState } from "react";

import "./FloatingDesktopToolbar.scss";

const STORAGE_KEY = "excalidraw-floating-toolbar-v3";
const DRAG_THRESHOLD_PX = 5;

type DockSide = "left" | "right" | null;
type Stored = { x: number; y: number; dockSide?: DockSide };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStored(): Partial<Stored> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Stored>) : {};
  } catch {
    return {};
  }
}

function isFinitePair(x: unknown, y: unknown): boolean {
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y)
  );
}

function persist(s: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

function defaultPosition(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 100, y: 72 };
  const pad = 16;
  return {
    x: Math.round(Math.max(pad, (window.innerWidth - 420) / 2)),
    y: Math.round(Math.max(pad, window.innerHeight - 72 - pad)),
  };
}

type FloatingDesktopToolbarProps = {
  children: React.ReactNode;
  zenModeEnabled: boolean;
};

/**
 * Draggable desktop shape toolbar with edge-docking.
 * All drag + dock logic uses direct DOM manipulation for reliability.
 */
export const FloatingDesktopToolbar: React.FC<FloatingDesktopToolbarProps> = ({
  children,
  zenModeEnabled,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  // Only used for initial render — all subsequent updates go through DOM directly
  const [initialPos] = useState((): { x: number; y: number } => {
    const s = readStored();
    if (isFinitePair(s.x, s.y)) {
      return { x: s.x as number, y: s.y as number };
    }
    return defaultPosition();
  });

  const [initialDock] = useState<DockSide>(() => {
    const s = readStored();
    return s.dockSide === "left" || s.dockSide === "right" ? s.dockSide : null;
  });

  // All mutable state lives in refs — NO React state updates for drag/dock
  const posRef = useRef<{ x: number; y: number }>({ ...initialPos });
  const dockRef = useRef<DockSide>(initialDock);
  const dragRef = useRef<{
    ox: number; oy: number; px: number; py: number; moved: boolean;
  } | null>(null);
  const blockClickRef = useRef(false);

  // ---- Direct DOM helpers ----
  const applyPosition = (el: HTMLElement, x: number, y: number) => {
    el.style.left = x + "px";
    el.style.top = y + "px";
  };

  const applyDockClass = (el: HTMLElement, side: DockSide) => {
    el.classList.remove(
      "floating-desktop-toolbar--docked-left",
      "floating-desktop-toolbar--docked-right",
    );
    if (side === "left") el.classList.add("floating-desktop-toolbar--docked-left");
    if (side === "right") el.classList.add("floating-desktop-toolbar--docked-right");
  };

  const snapToEdge = (el: HTMLElement, side: DockSide) => {
    if (!side) return;
    // Double-rAF: first frame lets flex-direction:column take effect,
    // second frame forces a full layout reflow so getBoundingClientRect()
    // returns the final vertical dimensions — not the pre-dock horizontal ones.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const m = 8;
        const rect = el.getBoundingClientRect();
        const maxX = Math.max(m, window.innerWidth - rect.width - m);
        const maxY = Math.max(m, window.innerHeight - rect.height - m);
        const x = side === "left" ? m : maxX;
        const y = clamp(posRef.current.y, m, maxY);
        posRef.current = { x, y };
        // Animate the final snap-to-edge movement
        el.style.transition =
          "left 0.28s cubic-bezier(0.4,0,0.2,1), top 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.5s ease-in-out";
        applyPosition(el, x, y);
        persist({ ...posRef.current, dockSide: dockRef.current });
        // Clear inline transition after animation completes so opacity still works via CSS
        setTimeout(() => {
          el.style.transition = "";
        }, 320);
      });
    });
  };

  // ---- Setup: apply initial state + attach drag listeners ----
  // useLayoutEffect: set position before paint. Do NOT put left/top or dock
  // classes on JSX — any re-render (e.g. zen mode) would reset DOM to stale
  // initialPos/initialDock and wipe out drag + reclamp state.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    // Apply initial state
    applyPosition(el, posRef.current.x, posRef.current.y);
    applyDockClass(el, dockRef.current);
    if (dockRef.current) {
      snapToEdge(el, dockRef.current);
    }

    // ---- Mouse handlers ----
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Kill any CSS transition so position follows cursor with zero lag
      el.style.transition = "opacity 0.5s ease-in-out";
      dragRef.current = {
        ox: posRef.current.x,
        oy: posRef.current.y,
        px: e.clientX,
        py: e.clientY,
        moved: false,
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;

      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;

      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        return;
      }

      if (!d.moved) {
        d.moved = true;
        // Undock on drag start
        dockRef.current = null;
        applyDockClass(el, null);
      }

      const m = 8;
      const rect = el.getBoundingClientRect();
      const maxX = Math.max(m, window.innerWidth - rect.width - m);
      const maxY = Math.max(m, window.innerHeight - rect.height - m);
      const nx = clamp(d.ox + dx, m, maxX);
      const ny = clamp(d.oy + dy, m, maxY);

      posRef.current = { x: nx, y: ny };
      applyPosition(el, nx, ny);

      e.preventDefault();
    };

    const onMouseUp = (e: MouseEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const d = dragRef.current;
      dragRef.current = null;
      if (!d || !d.moved) {
        // Restore default transition even if no drag happened
        el.style.transition = "";
        return;
      }

      blockClickRef.current = true;
      setTimeout(() => { blockClickRef.current = false; }, 0);

      // Detect dock: 15% zones OR toolbar physically against wall
      const leftBound = window.innerWidth * 0.15;
      const rightBound = window.innerWidth * 0.85;
      let side: DockSide = null;

      if (e.clientX <= leftBound) {
        side = "left";
      } else if (e.clientX >= rightBound) {
        side = "right";
      }

      // Also check toolbar physical position as fallback
      if (!side) {
        const rect = el.getBoundingClientRect();
        if (rect.left <= 30) side = "left";
        else if (rect.right >= window.innerWidth - 30) side = "right";
      }

      // Apply dock class first — CSS flex-direction:column kicks in immediately
      dockRef.current = side;
      applyDockClass(el, side);
      persist({ ...posRef.current, dockSide: side });

      if (side) {
        // snapToEdge handles its own animated transition internally
        snapToEdge(el, side);
      } else {
        // No dock — restore base CSS transition
        el.style.transition = "";
      }
    };

    // Capture phase so we get mousedown before tool buttons consume it
    el.addEventListener("mousedown", onMouseDown, { capture: true });

    // Click blocking after drag
    const onClickCapture = (e: MouseEvent) => {
      if (blockClickRef.current) {
        e.stopPropagation();
        e.preventDefault();
        blockClickRef.current = false;
      }
    };
    el.addEventListener("click", onClickCapture, { capture: true });

    // Keep the toolbar inside the visible viewport. Saved positions from a
    // larger display (e.g. screen share / second monitor) must be reclamped on
    // load — window "resize" often does not fire when simply reopening a tab.
    const reclampToViewport = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        return;
      }
      const m = 8;
      const maxX = Math.max(m, window.innerWidth - rect.width - m);
      const maxY = Math.max(m, window.innerHeight - rect.height - m);
      const ds = dockRef.current;
      let x = clamp(posRef.current.x, m, maxX);
      if (ds === "left") {
        x = m;
      }
      if (ds === "right") {
        x = maxX;
      }
      const y = clamp(posRef.current.y, m, maxY);
      const prev = posRef.current;
      if (prev.x !== x || prev.y !== y) {
        posRef.current = { x, y };
        applyPosition(el, x, y);
        persist({ ...posRef.current, dockSide: dockRef.current });
      }
    };

    const onResize = () => {
      reclampToViewport();
    };

    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", onResize);
      vv.addEventListener("scroll", onResize);
    }

    const onPageShow = () => {
      reclampToViewport();
    };
    window.addEventListener("pageshow", onPageShow);

    // After layout + dock snap (which uses nested rAF), ensure we're on-screen.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        reclampToViewport();
      });
    });
    const postDockClampId = window.setTimeout(() => {
      reclampToViewport();
    }, 400);

    return () => {
      window.clearTimeout(postDockClampId);
      el.removeEventListener("mousedown", onMouseDown, { capture: true });
      el.removeEventListener("click", onClickCapture, { capture: true });
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", onPageShow);
      if (vv) {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onResize);
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={clsx("floating-desktop-toolbar", {
        "floating-desktop-toolbar--zen": zenModeEnabled,
      })}
    >
      <div
        className="floating-desktop-toolbar__inner"
        style={{ touchAction: "none" }}
      >
        {children}
      </div>
    </div>
  );
};
