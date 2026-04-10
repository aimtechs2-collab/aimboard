import React, { useEffect, useState } from "react";
import clsx from "clsx";

import { capitalizeString } from "@excalidraw/common";

import { Popover } from "radix-ui";

import { trackEvent } from "../analytics";

import { ToolButton } from "./ToolButton";

import "./ToolPopover.scss";

import { useExcalidrawContainer } from "./App";

import type { AppClassProperties, ToolType } from "../types";

type ToolOption = {
  type: string;
  icon: React.ReactNode;
  title?: string;
};

type ToolPopoverProps = {
  app: AppClassProperties;
  options: readonly ToolOption[];
  activeTool: { type: string };
  defaultOption: string;
  className?: string;
  namePrefix: string;
  title: string;
  "data-testid": string;
  onToolChange: (type: string) => void;
  displayedOption: ToolOption;
  fillable?: boolean;
  /** Double-click opens tool-options popover anchored to this control */
  onOptionsDoubleClick?: (detail: {
    anchor: HTMLElement;
    toolType: ToolType;
  }) => void;
  optionsToolTypeForDoubleClick?: ToolType;
};

export const ToolPopover = ({
  app,
  options,
  activeTool,
  defaultOption,
  className = "Shape",
  namePrefix,
  title,
  "data-testid": dataTestId,
  onToolChange,
  displayedOption,
  fillable = false,
  onOptionsDoubleClick,
  optionsToolTypeForDoubleClick,
}: ToolPopoverProps) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const currentType = activeTool.type;
  const isActive = displayedOption.type === currentType;
  const SIDE_OFFSET = 32 / 2 + 10;
  const { container } = useExcalidrawContainer();

  // if currentType is not in options, close popup
  if (!options.some((o) => o.type === currentType) && isPopupOpen) {
    setIsPopupOpen(false);
  }

  // Close popover when user starts interacting with the canvas (pointer down)
  useEffect(() => {
    // app.onPointerDownEmitter emits when pointer down happens on canvas area
    const unsubscribe = app.onPointerDownEmitter.on(() => {
      setIsPopupOpen(false);
    });
    return () => unsubscribe?.();
  }, [app]);

  return (
    <Popover.Root open={isPopupOpen}>
      <Popover.Trigger asChild>
        <ToolButton
          className={clsx(className, {
            fillable,
            active: options.some((o) => o.type === activeTool.type),
          })}
          type="radio"
          icon={displayedOption.icon}
          checked={isActive}
          name="editor-current-shape"
          title={title}
          aria-label={title}
          data-testid={dataTestId}
          onPointerDown={() => {
            setIsPopupOpen((v) => !v);
            onToolChange(defaultOption);
          }}
          onDoubleClick={
            onOptionsDoubleClick && optionsToolTypeForDoubleClick
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsPopupOpen(false);
                  onOptionsDoubleClick({
                    anchor: e.currentTarget,
                    toolType: optionsToolTypeForDoubleClick,
                  });
                }
              : undefined
          }
        />
      </Popover.Trigger>

      <Popover.Content
        className="tool-popover-content"
        sideOffset={SIDE_OFFSET}
        collisionBoundary={container ?? undefined}
      >
        {options.map(({ type, icon, title }) => (
          <ToolButton
            className={clsx(className, {
              active: currentType === type,
            })}
            key={type}
            type="radio"
            icon={icon}
            checked={currentType === type}
            name={`${namePrefix}-option`}
            title={title || capitalizeString(type)}
            keyBindingLabel=""
            aria-label={title || capitalizeString(type)}
            data-testid={`toolbar-${type}`}
            onChange={() => {
              if (app.state.activeTool.type !== type) {
                trackEvent("toolbar", type, "ui");
              }
              app.setActiveTool({ type: type as any });
              onToolChange?.(type);
            }}
          />
        ))}
      </Popover.Content>
    </Popover.Root>
  );
};
