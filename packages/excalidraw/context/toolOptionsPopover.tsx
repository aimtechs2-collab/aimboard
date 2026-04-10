import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ToolType } from "../types";

type ToolOptionsPopoverContextValue = {
  open: (toolType: ToolType, anchorEl: HTMLElement) => void;
  close: () => void;
  toolType: ToolType | null;
  anchorRect: DOMRect | null;
};

const ToolOptionsPopoverContext =
  createContext<ToolOptionsPopoverContextValue | null>(null);

export const ToolOptionsPopoverProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [toolType, setToolType] = useState<ToolType | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    const el = anchorRef.current;
    if (el && el.isConnected) {
      setAnchorRect(el.getBoundingClientRect());
    }
  }, []);

  const open = useCallback(
    (nextToolType: ToolType, anchorEl: HTMLElement) => {
      anchorRef.current = anchorEl;
      setToolType(nextToolType);
      queueMicrotask(() => {
        if (anchorRef.current?.isConnected) {
          setAnchorRect(anchorRef.current.getBoundingClientRect());
        }
      });
    },
    [],
  );

  const close = useCallback(() => {
    setToolType(null);
    setAnchorRect(null);
    anchorRef.current = null;
  }, []);

  useEffect(() => {
    if (!toolType) {
      return;
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [toolType, updateRect]);

  const value: ToolOptionsPopoverContextValue = {
    open,
    close,
    toolType,
    anchorRect,
  };

  return (
    <ToolOptionsPopoverContext.Provider value={value}>
      {children}
    </ToolOptionsPopoverContext.Provider>
  );
};

export function useToolOptionsPopover(): ToolOptionsPopoverContextValue {
  const ctx = useContext(ToolOptionsPopoverContext);
  if (!ctx) {
    throw new Error(
      "useToolOptionsPopover must be used within ToolOptionsPopoverProvider",
    );
  }
  return ctx;
}
