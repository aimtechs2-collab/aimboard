import type {
  CellValueChangedEvent,
  ColDef,
  ColumnResizedEvent,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
  Module,
} from "ag-grid-community";
import { AllCommunityModule } from "ag-grid-community";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";

import type { SpreadsheetModel } from "../table/spreadsheetTypes";

type RowValue = Record<string, string | number>;

const colId = (i: number) => `col${i}`;

const colName = (i: number) => {
  let v = i + 1;
  let s = "";
  while (v > 0) {
    const m = (v - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
};

const modules: Module[] = [AllCommunityModule];

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

const normalizeClipboardData = (data: string[][]): string[][] => {
  if (!Array.isArray(data) || data.length === 0) {
    return data;
  }

  // AG Grid already parses TSV/Excel paste into columns.
  const looksLikeSingleColumn = data.every((row) => row.length <= 1);
  if (!looksLikeSingleColumn) {
    return data;
  }

  // If each row has commas, treat this as CSV and split safely (supports quoted values).
  const hasComma = data.some((row) => (row[0] ?? "").includes(","));
  if (!hasComma) {
    return data;
  }

  return data.map((row) => parseCsvLine(row[0] ?? ""));
};

const RowIndexCellRenderer: React.FC<ICellRendererParams<RowValue>> = (params) => {
  const rowNumber = Number(params.data?.__row ?? 0) + 1;

  return (
    <div className="aim-sheet-row-index-inner">
      <span>{rowNumber}</span>
      <button
        type="button"
        className="aim-sheet-row-resize-handle"
        title="Drag to resize row"
        onMouseDown={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const startY = ev.clientY;
          const startHeight = params.node.rowHeight ?? 24;

          const onMove = (moveEv: MouseEvent) => {
            const delta = moveEv.clientY - startY;
            const nextHeight = Math.max(20, Math.min(96, startHeight + delta));
            params.node.setRowHeight(nextHeight);
            params.api.onRowHeightChanged();
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };

          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
      />
    </div>
  );
};

export const SpreadsheetGrid: React.FC<{
  model: SpreadsheetModel;
  onModelChange: (model: SpreadsheetModel) => void;
}> = ({ model, onModelChange }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<GridApi<RowValue> | null>(null);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!hostRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) {
        return;
      }
      setHostSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    });
    obs.observe(hostRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!apiRef.current || hostSize.width <= 0) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      apiRef.current?.sizeColumnsToFit();
    });
    return () => window.cancelAnimationFrame(id);
  }, [hostSize.width, model.cols]);

  const headerHeight = 30;
  const rowHeight = Math.max(
    24,
    Math.min(140, Math.floor((hostSize.height - headerHeight) / Math.max(model.rows, 1))),
  );

  const columns = useMemo<ColDef<RowValue>[]>(
    () => [
      {
        field: "__row",
        headerName: "",
        editable: false,
        width: 52,
        minWidth: 52,
        maxWidth: 52,
        pinned: "left",
        lockPosition: true,
        suppressMovable: true,
        cellClass: "aim-sheet-row-index",
        cellRenderer: RowIndexCellRenderer,
      },
      ...Array.from({ length: model.cols }, (_, i) => ({
        field: colId(i),
        headerName: colName(i),
        editable: true,
        resizable: true,
        ...(Number(model.colWidths?.[i] ?? 0) > 0
          ? { width: Number(model.colWidths?.[i]) }
          : { flex: 1 }),
        minWidth: 72,
      })),
    ],
    [model.cols, model.colWidths],
  );

  const rowData = useMemo<RowValue[]>(
    () =>
      model.data.map((row, rowIndex) => {
        const obj: RowValue = { __row: rowIndex };
        for (let c = 0; c < model.cols; c++) {
          obj[colId(c)] = row[c] ?? "";
        }
        return obj;
      }),
    [model.cols, model.data],
  );

  const applyMatrixAtFocusedCell = useCallback(
    (matrix: string[][]) => {
      if (!matrix.length) {
        return;
      }
      const api = apiRef.current;
      if (!api) {
        return;
      }

      const focused = api.getFocusedCell();
      if (!focused) {
        return;
      }

      const startRow = focused.rowIndex ?? 0;
      const focusedColId = focused.column?.getColId?.() ?? "col0";
      const startCol =
        focusedColId === "__row"
          ? 0
          : Number(focusedColId.replace(/^col/, "")) || 0;

      const next = model.data.map((r) => [...r]);
      for (let r = 0; r < matrix.length; r++) {
        const targetRow = startRow + r;
        if (targetRow < 0 || targetRow >= model.rows) {
          break;
        }
        const row = matrix[r] ?? [];
        for (let c = 0; c < row.length; c++) {
          const targetCol = startCol + c;
          if (targetCol < 0 || targetCol >= model.cols) {
            break;
          }
          next[targetRow][targetCol] = row[c] ?? "";
        }
      }

      onModelChange({ ...model, data: next });
    },
    [model, onModelChange],
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const raw = event.clipboardData?.getData("text/plain");
      if (!raw) {
        return;
      }
      const rows = raw
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));
      if (!rows.length) {
        return;
      }

      const matrix = normalizeClipboardData(rows.map((line) => [line]));
      if (!matrix.length) {
        return;
      }

      // Always route paste through table placement, even during inline edit mode.
      event.preventDefault();
      event.stopPropagation();
      applyMatrixAtFocusedCell(matrix);
    },
    [applyMatrixAtFocusedCell],
  );

  return (
    <div
      ref={hostRef}
      className="aim-sheet-grid ag-theme-quartz"
      onPasteCapture={handlePasteCapture}
    >
      <AgGridReact<RowValue>
        modules={modules}
        columnDefs={columns}
        rowData={rowData}
        defaultColDef={{
          editable: true,
          sortable: false,
          filter: false,
          resizable: true,
          suppressHeaderMenuButton: true,
          suppressHeaderContextMenu: true,
        }}
        rowSelection={undefined}
        cellSelection={true}
        singleClickEdit={true}
        enableCellTextSelection={true}
        suppressMovableColumns={true}
        suppressRowClickSelection={true}
        suppressContextMenu={true}
        headerHeight={headerHeight}
        rowHeight={rowHeight}
        stopEditingWhenCellsLoseFocus={true}
        onGridReady={(evt: GridReadyEvent<RowValue>) => {
          apiRef.current = evt.api;
          evt.api.sizeColumnsToFit();
        }}
        onGridSizeChanged={() => {
          // Keep the table content scaled to the embeddable size so resizing
          // grows/shrinks cells instead of exposing blank background.
          apiRef.current?.sizeColumnsToFit();
        }}
        processDataFromClipboard={(params) =>
          normalizeClipboardData(params.data as string[][])
        }
        onColumnResized={(evt: ColumnResizedEvent<RowValue>) => {
          if (!evt.finished) {
            return;
          }
          if (evt.source === "sizeColumnsToFit") {
            return;
          }
          const cols = evt.api
            .getColumns()
            ?.filter((c) => c.getColId() !== "__row")
            .map((c) => c.getActualWidth());
          if (!cols || cols.length !== model.cols) {
            return;
          }
          const unchanged =
            (model.colWidths ?? []).length === cols.length &&
            cols.every((w, i) => Number(model.colWidths?.[i] ?? 0) === w);
          if (unchanged) {
            return;
          }
          onModelChange({ ...model, colWidths: cols });
        }}
        onCellValueChanged={(evt: CellValueChangedEvent<RowValue>) => {
          const row = Number(evt.data?.__row);
          const field = typeof evt.colDef.field === "string" ? evt.colDef.field : "";
          if (!Number.isFinite(row) || !field.startsWith("col")) {
            return;
          }
          const col = Number(field.slice(3));
          if (!Number.isFinite(col) || col < 0 || col >= model.cols) {
            return;
          }
          const next = model.data.map((r) => [...r]);
          next[row][col] = evt.newValue == null ? "" : String(evt.newValue);
          onModelChange({ ...model, data: next });
        }}
      />
    </div>
  );
};
