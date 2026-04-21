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

const colNameToIndex = (name: string) => {
  let idx = 0;
  const upper = name.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const code = upper.charCodeAt(i);
    if (code < 65 || code > 90) {
      return -1;
    }
    idx = idx * 26 + (code - 64);
  }
  return idx - 1;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const tokenizeArithmetic = (expression: string): string[] | null => {
  const compact = expression.replace(/\s+/g, "");
  if (!compact) {
    return [];
  }
  if (!/^[0-9+\-*/().]+$/.test(compact)) {
    return null;
  }
  const tokens = compact.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  return tokens ?? null;
};

const precedence = (op: string) => {
  if (op === "+" || op === "-") {
    return 1;
  }
  if (op === "*" || op === "/") {
    return 2;
  }
  return 0;
};

const applyOp = (values: number[], op: string): boolean => {
  const b = values.pop();
  const a = values.pop();
  if (a == null || b == null) {
    return false;
  }
  if (op === "+") {
    values.push(a + b);
    return true;
  }
  if (op === "-") {
    values.push(a - b);
    return true;
  }
  if (op === "*") {
    values.push(a * b);
    return true;
  }
  if (op === "/") {
    if (b === 0) {
      values.push(Number.NaN);
      return true;
    }
    values.push(a / b);
    return true;
  }
  return false;
};

const evaluateArithmeticExpression = (expression: string): number | null => {
  const tokens = tokenizeArithmetic(expression);
  if (!tokens) {
    return null;
  }

  const normalized: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prev = normalized[normalized.length - 1];
    if (token === "-" && (i === 0 || prev === "(" || prev === "+" || prev === "-" || prev === "*" || prev === "/")) {
      normalized.push("0");
      normalized.push("-");
      continue;
    }
    normalized.push(token);
  }

  const values: number[] = [];
  const ops: string[] = [];
  for (const token of normalized) {
    if (/^\d/.test(token)) {
      values.push(Number(token));
      continue;
    }
    if (token === "(") {
      ops.push(token);
      continue;
    }
    if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") {
        const op = ops.pop()!;
        if (!applyOp(values, op)) {
          return null;
        }
      }
      if (ops[ops.length - 1] !== "(") {
        return null;
      }
      ops.pop();
      continue;
    }
    while (ops.length && precedence(ops[ops.length - 1]) >= precedence(token)) {
      const op = ops.pop()!;
      if (!applyOp(values, op)) {
        return null;
      }
    }
    ops.push(token);
  }

  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") {
      return null;
    }
    if (!applyOp(values, op)) {
      return null;
    }
  }

  if (values.length !== 1 || !Number.isFinite(values[0])) {
    return null;
  }
  return values[0];
};

const buildExpandedModel = (
  model: SpreadsheetModel,
  requiredRows: number,
  requiredCols: number,
): SpreadsheetModel => {
  const rows = Math.min(200, Math.max(model.rows, requiredRows));
  const cols = Math.min(100, Math.max(model.cols, requiredCols));
  if (rows === model.rows && cols === model.cols) {
    return model;
  }

  const data = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => model.data[r]?.[c] ?? ""),
  );
  const colWidths = Array.from({ length: cols }, (_, i) => model.colWidths?.[i] ?? 0);
  return { ...model, rows, cols, data, colWidths };
};

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

const parseClipboardLine = (line: string): string[] => {
  if (line.includes("\t")) {
    return line.split("\t");
  }
  if (line.includes(",")) {
    return parseCsvLine(line);
  }
  return [line];
};

const isMarkdownSeparatorCell = (cell: string) =>
  /^:?-{3,}:?$/.test(cell.trim());

const parseMarkdownTableTextToMatrix = (raw: string): string[][] | null => {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const looksLikeMarkdownTable = lines.every((line) => line.includes("|"));
  if (!looksLikeMarkdownTable) {
    return null;
  }

  const rows = lines
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts[0] === "") {
        parts.shift();
      }
      if (parts[parts.length - 1] === "") {
        parts.pop();
      }
      return parts;
    })
    .filter((cells) => cells.length > 0);

  if (rows.length < 2) {
    return null;
  }

  const nonSeparatorRows = rows.filter(
    (cells) => !cells.every((cell) => isMarkdownSeparatorCell(cell)),
  );
  if (!nonSeparatorRows.length) {
    return null;
  }

  const maxCols = Math.max(...nonSeparatorRows.map((row) => row.length), 0);
  if (maxCols <= 0) {
    return null;
  }

  return nonSeparatorRows.map((row) => {
    const padded = [...row];
    while (padded.length < maxCols) {
      padded.push("");
    }
    return padded;
  });
};

const parseMarkdownRowsToMatrix = (rows: string[]): string[][] | null =>
  parseMarkdownTableTextToMatrix(rows.join("\n"));

const parseClipboardTextToMatrix = (raw: string): string[][] => {
  const markdownMatrix = parseMarkdownTableTextToMatrix(raw);
  if (markdownMatrix) {
    return markdownMatrix;
  }

  const rows = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));

  return rows.map(parseClipboardLine);
};

const evaluateFormula = (
  raw: string,
  model: SpreadsheetModel,
  visiting: Set<string>,
): string | number => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("=")) {
    return raw;
  }

  const expression = trimmed.slice(1).trim();
  if (!expression) {
    return "";
  }

  const getCellNumericValue = (ref: string): number => {
    const match = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
    if (!match) {
      return 0;
    }
    const col = colNameToIndex(match[1]);
    const row = Number(match[2]) - 1;
    if (col < 0 || row < 0 || row >= model.rows || col >= model.cols) {
      return 0;
    }
    const key = `${row}:${col}`;
    if (visiting.has(key)) {
      throw new Error("CYCLE");
    }
    visiting.add(key);
    const cellRaw = String(model.data[row]?.[col] ?? "");
    let value: string | number = "";
    try {
      value = evaluateFormula(cellRaw, model, visiting);
    } finally {
      visiting.delete(key);
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const fnMatch = /^(SUM|AVERAGE|AVG|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)$/i.exec(
    expression,
  );
  if (fnMatch) {
    const fn = fnMatch[1].toUpperCase();
    const start = /^([A-Z]+)(\d+)$/i.exec(fnMatch[2]);
    const end = /^([A-Z]+)(\d+)$/i.exec(fnMatch[3]);
    if (!start || !end) {
      return "#ERR";
    }
    const startCol = colNameToIndex(start[1]);
    const endCol = colNameToIndex(end[1]);
    const startRow = Number(start[2]) - 1;
    const endRow = Number(end[2]) - 1;
    if (
      startCol < 0 ||
      endCol < 0 ||
      startRow < 0 ||
      endRow < 0 ||
      startCol >= model.cols ||
      endCol >= model.cols ||
      startRow >= model.rows ||
      endRow >= model.rows
    ) {
      return "#ERR";
    }

    const c0 = Math.min(startCol, endCol);
    const c1 = Math.max(startCol, endCol);
    const r0 = Math.min(startRow, endRow);
    const r1 = Math.max(startRow, endRow);
    const values: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const n = getCellNumericValue(`${colName(c)}${r + 1}`);
        values.push(n);
      }
    }
    if (!values.length) {
      return 0;
    }
    if (fn === "SUM") {
      return values.reduce((acc, n) => acc + n, 0);
    }
    if (fn === "MIN") {
      return Math.min(...values);
    }
    if (fn === "MAX") {
      return Math.max(...values);
    }
    const total = values.reduce((acc, n) => acc + n, 0);
    return total / values.length;
  }

  try {
    const replaced = expression.replace(/\b([A-Z]+)(\d+)\b/gi, (_, col, row) =>
      String(getCellNumericValue(`${col}${row}`)),
    );
    const result = evaluateArithmeticExpression(replaced);
    return isFiniteNumber(result) ? result : "#ERR";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CYCLE") {
      return "#CYCLE";
    }
    return "#ERR";
  }
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

  const singleColRows = data.map((row) => String(row[0] ?? ""));
  const markdownMatrix = parseMarkdownRowsToMatrix(singleColRows);
  if (markdownMatrix) {
    return markdownMatrix;
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
        valueFormatter: (params: { value: unknown }) => {
          const raw = params.value == null ? "" : String(params.value);
          const display = evaluateFormula(raw, model, new Set());
          return display == null ? "" : String(display);
        },
        ...(Number(model.colWidths?.[i] ?? 0) > 0
          ? { width: Number(model.colWidths?.[i]) }
          : { flex: 1 }),
        minWidth: 72,
      })),
    ],
    [model],
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
      const focused = api?.getFocusedCell();

      const startRow = focused?.rowIndex ?? 0;
      const focusedColId = focused?.column?.getColId?.() ?? "col0";
      const startCol =
        focusedColId === "__row"
          ? 0
          : Number(focusedColId.replace(/^col/, "")) || 0;

      const maxColsInMatrix = matrix.reduce((max, row) => Math.max(max, row.length), 0);
      const expandedModel = buildExpandedModel(
        model,
        startRow + matrix.length,
        startCol + maxColsInMatrix,
      );
      const next = expandedModel.data.map((r) => [...r]);
      for (let r = 0; r < matrix.length; r++) {
        const targetRow = startRow + r;
        if (targetRow < 0 || targetRow >= expandedModel.rows) {
          break;
        }
        const row = matrix[r] ?? [];
        for (let c = 0; c < row.length; c++) {
          const targetCol = startCol + c;
          if (targetCol < 0 || targetCol >= expandedModel.cols) {
            break;
          }
          next[targetRow][targetCol] = row[c] ?? "";
        }
      }

      onModelChange({ ...expandedModel, data: next });
    },
    [model, onModelChange],
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const raw = event.clipboardData?.getData("text/plain");
      if (!raw) {
        return;
      }
      const api = apiRef.current;
      if (api?.getEditingCells()?.length) {
        const simpleText = !/[\n\r\t|]/.test(raw);
        if (simpleText) {
          return;
        }
      }
      const matrix = normalizeClipboardData(parseClipboardTextToMatrix(raw));
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
        undoRedoCellEditing={true}
        undoRedoCellEditingLimit={100}
        enterNavigatesVertically={true}
        enterNavigatesVerticallyAfterEdit={true}
        singleClickEdit={true}
        enableCellTextSelection={true}
        suppressMovableColumns={true}
        suppressRowClickSelection={true}
        suppressContextMenu={false}
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
