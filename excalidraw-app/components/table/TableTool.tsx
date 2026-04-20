import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { insertSpreadsheetBlock } from "./insertSpreadsheetBlock";
import { TablePicker } from "./TablePicker";

const TOOLBAR_ROW_SELECTOR = ".excalidraw .App-toolbar .Stack_horizontal";
const TOOLBAR_FALLBACK_SELECTOR = ".excalidraw .App-toolbar";

const useToolbarSlot = () => {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const ensureSlot = () => {
      if (cancelled) {
        return;
      }
      const rows = Array.from(
        document.querySelectorAll(TOOLBAR_ROW_SELECTOR),
      ) as HTMLElement[];
      const toolbar =
        rows[rows.length - 1] ??
        (document.querySelector(TOOLBAR_FALLBACK_SELECTOR) as HTMLElement | null);

      if (!toolbar) {
        return;
      }

      const existing = slotRef.current;
      if (existing && existing.parentElement === toolbar) {
        return;
      }

      if (existing && existing.parentElement !== toolbar) {
        existing.remove();
      }

      const slotEl = document.createElement("div");
      slotEl.className = "aim-table-tool__slot";
      toolbar.appendChild(slotEl);
      slotRef.current = slotEl;
      setSlot(slotEl);
    };

    ensureSlot();

    const observer = new MutationObserver(() => {
      ensureSlot();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const interval = window.setInterval(ensureSlot, 500);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearInterval(interval);
      if (slotRef.current && slotRef.current.parentElement) {
        slotRef.current.remove();
      }
      slotRef.current = null;
    };
  }, []);

  return slot;
};

export const TableTool: React.FC<{
  excalidrawAPI: ExcalidrawImperativeAPI;
  iconOnly?: boolean;
}> = ({ excalidrawAPI }) => {
  const slot = useToolbarSlot();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocPointer = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) {
        return;
      }
      if (wrapperRef.current && wrapperRef.current.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    return () =>
      document.removeEventListener("pointerdown", onDocPointer, true);
  }, [open]);

  if (!slot) {
    return null;
  }

  return createPortal(
    <div className="aim-table-tool" ref={wrapperRef}>
      <button
        type="button"
        className={`aim-table-tool__button${
          open ? " aim-table-tool__button--open" : ""
        }`}
        title="Insert spreadsheet table"
        aria-label="Insert spreadsheet table"
        aria-expanded={open}
        onPointerDown={(ev) => ev.stopPropagation()}
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          role="img"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15M15 4.5v15" />
        </svg>
      </button>
      {open ? (
        <div className="aim-table-tool__popover">
          <TablePicker
            onSelect={(rows, cols) => {
              insertSpreadsheetBlock(excalidrawAPI, rows, cols);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>,
    slot,
  );
};
