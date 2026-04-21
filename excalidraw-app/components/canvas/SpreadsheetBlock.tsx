import { debounce } from "@excalidraw/common";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import type {
  ExcalidrawEmbeddableElement,
  NonDeleted,
} from "@excalidraw/element/types";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";

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
  const [draftModel, setDraftModel] = useState<SpreadsheetModel>(model);
  const persistRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    setDraftModel(model);
  }, [model]);

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

  return (
    <div className="aim-sheet-block">
      <Suspense fallback={<div className="aim-sheet-grid-loading">Loading table...</div>}>
        <LazySpreadsheetGrid
          model={draftModel}
          onModelChange={(next) => {
            setDraftModel(next);
            persistRef.current?.(next);
          }}
        />
      </Suspense>
    </div>
  );
};
