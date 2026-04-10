import clsx from "clsx";
import { Popover } from "radix-ui";
import React, { useEffect, useRef } from "react";

import { CLASSES, capitalizeString } from "@excalidraw/common";

import { useToolOptionsPopover } from "../context/toolOptionsPopover";

import type { ActionManager } from "../actions/manager";
import type {
  AppClassProperties,
  AppState,
  ToolType,
  UIAppState,
} from "../types";

import {
  CompactShapeActions,
  SelectedShapeActions,
} from "./Actions";
import { useEditorInterface, useExcalidrawContainer } from "./App";
import { CloseIcon } from "./icons";
import { Island } from "./Island";
import { t } from "../i18n";

import "./ToolOptionsPopover.scss";

const PROPERTIES_CLASSES = clsx([
  CLASSES.SHAPE_ACTIONS_THEME_SCOPE,
  "properties-content",
  "tool-options-popover",
]);

type ToolOptionsPopoverProps = {
  appState: UIAppState;
  app: AppClassProperties;
  setAppState: React.Component<any, AppState>["setState"];
  actionManager: ActionManager;
};

export const ToolOptionsPopover: React.FC<ToolOptionsPopoverProps> = ({
  appState,
  app,
  setAppState,
  actionManager,
}) => {
  const { toolType, anchorRect, close } = useToolOptionsPopover();
  const editorInterface = useEditorInterface();
  const { container } = useExcalidrawContainer();
  /** Which tool the open panel is for; reset when toolType changes so we do not close on open/switch-panel. */
  const panelToolRef = useRef<ToolType | null>(null);

  useEffect(() => {
    if (toolType) {
      setAppState({ openPopup: null });
    }
  }, [toolType, setAppState]);

  useEffect(() => {
    if (!toolType) {
      panelToolRef.current = null;
      return;
    }
    if (panelToolRef.current !== toolType) {
      panelToolRef.current = toolType;
      return;
    }
    if (appState.activeTool.type !== toolType) {
      close();
    }
  }, [appState.activeTool.type, toolType, close]);

  const open = Boolean(toolType && anchorRect);

  return (
    <Popover.Root
      modal={false}
      open={open}
      onOpenChange={() => {
        /* Keep open until user clicks the header close button (outside/Escape prevented on Content). */
      }}
    >
      {toolType && anchorRect && (
        <Popover.Anchor asChild>
          <span
            className="tool-options-popover__anchor"
            style={{
              position: "fixed",
              top: anchorRect.top,
              left: anchorRect.left,
              width: Math.max(anchorRect.width, 1),
              height: Math.max(anchorRect.height, 1),
              pointerEvents: "none",
            }}
          />
        </Popover.Anchor>
      )}
      {toolType && (
        <Popover.Portal container={container ?? undefined}>
          <Popover.Content
            className={clsx(
              "focus-visible-none",
              PROPERTIES_CLASSES,
              "tool-options-popover__content",
            )}
            side="top"
            align="center"
            sideOffset={10}
            collisionPadding={12}
            style={{
              zIndex: "var(--zIndex-ui-styles-popup)",
            }}
            onPointerDownOutside={(e) => {
              e.preventDefault();
            }}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
            }}
            onOpenAutoFocus={(e) => {
              if (editorInterface.isTouchScreen) {
                e.preventDefault();
              }
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            <Island padding={2} className="tool-options-popover__panel">
              <div className="tool-options-popover__header">
                <button
                  type="button"
                  className="tool-options-popover__close"
                  onClick={() => close()}
                  aria-label={t("buttons.close")}
                  title={t("buttons.close")}
                >
                  <span className="tool-options-popover__close-icon" aria-hidden="true">
                    {CloseIcon}
                  </span>
                  <span className="tool-options-popover__close-text">
                    {t("buttons.close")}
                  </span>
                </button>
                <span className="tool-options-popover__title">
                  {capitalizeString(t(`toolBar.${toolType}`))}
                </span>
              </div>
              <div className="tool-options-popover__body">
                {editorInterface.formFactor === "phone" ? (
                  <CompactShapeActions
                    appState={appState}
                    elementsMap={app.scene.getNonDeletedElementsMap()}
                    renderAction={actionManager.renderAction}
                    app={app}
                    setAppState={setAppState}
                    styleToolOverride={toolType}
                  />
                ) : (
                  <SelectedShapeActions
                    appState={appState}
                    elementsMap={app.scene.getNonDeletedElementsMap()}
                    renderAction={actionManager.renderAction}
                    app={app}
                    styleToolOverride={toolType}
                  />
                )}
              </div>
            </Island>
            <Popover.Arrow
              width={20}
              height={10}
              className="tool-options-popover__arrow"
              style={{
                fill: "var(--popup-bg-color)",
                filter: "drop-shadow(rgba(0, 0, 0, 0.05) 0px 3px 2px)",
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
};
