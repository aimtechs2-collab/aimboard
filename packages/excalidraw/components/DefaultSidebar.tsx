import clsx from "clsx";
import { useCallback, useRef } from "react";

import {
  AIMTUTOR_AI_CHAT_TAB,
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  LIBRARY_SIDEBAR_TAB,
  composeEventHandlers,
} from "@excalidraw/common";

import type { MarkOptional, Merge } from "@excalidraw/common/utility-types";

import { useTunnels } from "../context/tunnels";
import { useUIAppState } from "../context/ui-appState";

import "../components/dropdownMenu/DropdownMenu.scss";

import { useExcalidrawSetAppState } from "./App";
import { LibraryMenu } from "./LibraryMenu";
import { Sidebar } from "./Sidebar/Sidebar";
import { withInternalFallback } from "./hoc/withInternalFallback";
import { LibraryIcon, messageCircleIcon } from "./icons";

import type { SidebarProps, SidebarTriggerProps } from "./Sidebar/common";

const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 560;

const SidebarResizeHandle = () => {
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const sidebarEl = event.currentTarget.closest(
        ".sidebar",
      ) as HTMLElement | null;
      if (!sidebarEl) {
        return;
      }
      const excalidrawEl = sidebarEl.closest(
        ".excalidraw",
      ) as HTMLElement | null;
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: sidebarEl.getBoundingClientRect().width,
      };
      event.currentTarget.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!resizeStateRef.current) {
          return;
        }
        const deltaX = resizeStateRef.current.startX - moveEvent.clientX;
        const nextWidth = Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(
            SIDEBAR_MAX_WIDTH,
            resizeStateRef.current.startWidth + deltaX,
          ),
        );
        excalidrawEl?.style.setProperty(
          "--aim-right-sidebar-width",
          `${nextWidth}px`,
        );
      };

      const onPointerUp = () => {
        resizeStateRef.current = null;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [],
  );

  return (
    <button
      type="button"
      className="aim-ai-chat__resize-handle"
      onPointerDown={onResizeStart}
      aria-label="Resize sidebar"
      title="Drag to resize sidebar"
    >
      <span />
    </button>
  );
};

const DefaultSidebarTrigger = withInternalFallback(
  "DefaultSidebarTrigger",
  (
    props: Omit<SidebarTriggerProps, "name"> &
      React.HTMLAttributes<HTMLDivElement>,
  ) => {
    const { DefaultSidebarTriggerTunnel } = useTunnels();
    return (
      <DefaultSidebarTriggerTunnel.In>
        <Sidebar.Trigger
          {...props}
          className="default-sidebar-trigger"
          name={DEFAULT_SIDEBAR.name}
        />
      </DefaultSidebarTriggerTunnel.In>
    );
  },
);
DefaultSidebarTrigger.displayName = "DefaultSidebarTrigger";

const DefaultTabTriggers = ({ children }: { children: React.ReactNode }) => {
  const { DefaultSidebarTabTriggersTunnel } = useTunnels();
  return (
    <DefaultSidebarTabTriggersTunnel.In>
      {children}
    </DefaultSidebarTabTriggersTunnel.In>
  );
};
DefaultTabTriggers.displayName = "DefaultTabTriggers";

export const DefaultSidebar = Object.assign(
  withInternalFallback(
    "DefaultSidebar",
    ({
      children,
      className,
      onDock,
      docked,
      ...rest
    }: Merge<
      MarkOptional<Omit<SidebarProps, "name">, "children">,
      {
        /** pass `false` to disable docking */
        onDock?: SidebarProps["onDock"] | false;
      }
    >) => {
      const appState = useUIAppState();
      const setAppState = useExcalidrawSetAppState();

      const { AiChatSidebarTunnel } = useTunnels();
      const isCanvasSearchOpen =
        appState.openSidebar?.name === DEFAULT_SIDEBAR.name &&
        appState.openSidebar?.tab === CANVAS_SEARCH_TAB;

      if (isCanvasSearchOpen) {
        return null;
      }

      return (
        <Sidebar
          {...rest}
          name="default"
          key="default"
          className={clsx("default-sidebar", className)}
          docked={docked ?? appState.defaultSidebarDockedPreference}
          onDock={
            onDock === false || (!onDock && docked != null)
              ? undefined
              : composeEventHandlers(onDock, (dockedNext) => {
                  setAppState({ defaultSidebarDockedPreference: dockedNext });
                })
          }
        >
          <Sidebar.Tabs>
            <Sidebar.Header>
              <Sidebar.TabTriggers>
                <Sidebar.TabTrigger
                  tab={LIBRARY_SIDEBAR_TAB}
                  title="Library"
                  aria-label="Library"
                >
                  {LibraryIcon}
                </Sidebar.TabTrigger>
                <Sidebar.TabTrigger
                  tab={AIMTUTOR_AI_CHAT_TAB}
                  title="AI chat"
                  aria-label="AI chat"
                >
                  {messageCircleIcon}
                </Sidebar.TabTrigger>
              </Sidebar.TabTriggers>
            </Sidebar.Header>
            <Sidebar.Tab tab={LIBRARY_SIDEBAR_TAB}>
              <LibraryMenu />
            </Sidebar.Tab>
            <Sidebar.Tab tab={AIMTUTOR_AI_CHAT_TAB}>
              <AiChatSidebarTunnel.Out />
            </Sidebar.Tab>
            {children}
          </Sidebar.Tabs>
          <SidebarResizeHandle />
        </Sidebar>
      );
    },
  ),
  {
    Trigger: DefaultSidebarTrigger,
    TabTriggers: DefaultTabTriggers,
  },
);
