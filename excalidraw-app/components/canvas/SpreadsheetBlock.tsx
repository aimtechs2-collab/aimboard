import { debounce } from "@excalidraw/common";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import type {
  ExcalidrawEmbeddableElement,
  NonDeleted,
} from "@excalidraw/element/types";
import React, { Suspense, useCallback, useEffect, useMemo, useRef } from "react";

import {
  AIM_SPREADSHEET_CUSTOM_KEY,
  normalizeModel,
  type SpreadsheetCustomData,
  type SpreadsheetModel,
} from "../table/spreadsheetTypes";

const LazySpreadsheetGrid = React.lazy(async () => {
  const mod = await import("./SpreadsheetGrid");
  return { default: mod.SpreadsheetGrid };
});

type EmbeddableEl = NonDeleted<ExcalidrawEmbeddableElement>;

const readModel = (el: EmbeddableEl): SpreadsheetModel => {
  const custom = el.customData?.[AIM_SPREADSHEET_CUSTOM_KEY] as
    | SpreadsheetCustomData
    | undefined;
  return normalizeModel(custom?.model);
};

export const SpreadsheetBlock: React.FC<{ element: EmbeddableEl }> = ({
  element,
}) => {
  const api = useExcalidrawAPI();
  const model = useMemo(() => readModel(element), [element.versionNonce, element.id]);
  const persistRef = useRef<ReturnType<typeof debounce> | null>(null);
  const dragStateRef = useRef<{
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    const persist = debounce((nextModel: SpreadsheetModel) => {
      if (!api || api.isDestroyed) {
        return;
      }
      const latest = api
        .getSceneElements()
        .find((el) => el.id === element.id) as EmbeddableEl | undefined;
      if (!latest || latest.type !== "embeddable") {
        return;
      }
      api.mutateElement(latest, {
        customData: {
          ...(latest.customData ?? {}),
          [AIM_SPREADSHEET_CUSTOM_KEY]: { model: nextModel },
        },
      });
    }, 200);
    persistRef.current = persist;
    return () => persist.cancel();
  }, [api, element.id]);

  const onMoveHandlePointerDown = useCallback(
    (ev: React.PointerEvent<HTMLButtonElement>) => {
      if (!api || api.isDestroyed) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();

      const latest = api
        .getSceneElements()
        .find((el) => el.id === element.id) as EmbeddableEl | undefined;
      if (!latest || latest.type !== "embeddable") {
        return;
      }

      dragStateRef.current = {
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startX: latest.x,
        startY: latest.y,
      };

      const onMove = (moveEv: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state) {
          return;
        }
        const zoom = api.getAppState().zoom.value || 1;
        const dx = (moveEv.clientX - state.startClientX) / zoom;
        const dy = (moveEv.clientY - state.startClientY) / zoom;
        const fresh = api
          .getSceneElements()
          .find((el) => el.id === element.id) as EmbeddableEl | undefined;
        if (!fresh || fresh.type !== "embeddable") {
          return;
        }
        api.mutateElement(fresh, {
          x: state.startX + dx,
          y: state.startY + dy,
        });
      };

      const onUp = () => {
        dragStateRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [api, element.id],
  );

  return (
    <div className="aim-sheet-block">
      <button
        type="button"
        className="aim-sheet-block__move-handle"
        title="Drag to move table block"
        onPointerDown={onMoveHandlePointerDown}
      >
        Move
      </button>
      <Suspense fallback={<div className="aim-sheet-grid-loading">Loading table...</div>}>
        <LazySpreadsheetGrid
          model={model}
          onModelChange={(next) => persistRef.current?.(next)}
        />
      </Suspense>
    </div>
  );
};
