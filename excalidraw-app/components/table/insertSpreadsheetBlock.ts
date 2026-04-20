import { newEmbeddableElement } from "@excalidraw/element";
import {
  CaptureUpdateAction,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  AIM_SPREADSHEET_CUSTOM_KEY,
  AIM_SPREADSHEET_LINK,
  buildEmptyModel,
} from "./spreadsheetTypes";

export const insertSpreadsheetBlock = (
  api: ExcalidrawImperativeAPI,
  rows: number,
  cols: number,
) => {
  if (api.isDestroyed) {
    return;
  }

  const model = buildEmptyModel(rows, cols);
  const appState = api.getAppState();
  const viewportCenter = {
    clientX: appState.offsetLeft + appState.width / 2,
    clientY: appState.offsetTop + appState.height / 2,
  };
  const scenePoint = viewportCoordsToSceneCoords(viewportCenter, appState);

  const rowIndexCol = 52;
  const width = Math.min(860, Math.max(300, rowIndexCol + model.cols * 88 + 8));
  const height = Math.min(680, Math.max(200, 32 + model.rows * 24 + 12));

  const element = newEmbeddableElement({
    type: "embeddable",
    x: scenePoint.x - width / 2,
    y: scenePoint.y - height / 2,
    width,
    height,
    strokeWidth: 2,
    backgroundColor: "transparent",
    link: AIM_SPREADSHEET_LINK,
    customData: {
      [AIM_SPREADSHEET_CUSTOM_KEY]: { model },
    },
  });

  api.updateScene({
    elements: [...api.getSceneElements(), element],
    appState: { selectedElementIds: { [element.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};
