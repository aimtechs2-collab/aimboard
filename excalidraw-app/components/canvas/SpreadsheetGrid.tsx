import type {
  CellClickedEvent,
  CellFocusedEvent,
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
import * as XLSX from "xlsx";

import type {
  SpreadsheetCellStyle,
  SpreadsheetModel,
} from "../table/spreadsheetTypes";

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
const cellStyleKey = (row: number, col: number) => `${row}:${col}`;

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

const normalizeImportedMatrix = (matrix: string[][]): string[][] => {
  const cleanRows = matrix
    .map((row) => row.map((cell) => (cell == null ? "" : String(cell))))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (!cleanRows.length) {
    return [];
  }
  const maxCols = Math.max(...cleanRows.map((row) => row.length), 1);
  return cleanRows.map((row) => {
    const next = [...row];
    while (next.length < maxCols) {
      next.push("");
    }
    return next;
  });
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

const AlignIcon: React.FC<{ align: "left" | "center" | "right" }> = ({ align }) => (
  <span className={`aim-sheet-align-icon aim-sheet-align-icon--${align}`} aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
);

export const SpreadsheetGrid: React.FC<{
  model: SpreadsheetModel;
  onModelChange: (model: SpreadsheetModel) => void;
}> = ({ model, onModelChange }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridBodyRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<GridApi<RowValue> | null>(null);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [formulaInput, setFormulaInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!gridBodyRef.current || typeof ResizeObserver === "undefined") {
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
    obs.observe(gridBodyRef.current);
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
        cellStyle: (params: { data?: RowValue }) => {
          const row = Number(params.data?.__row);
          if (!Number.isFinite(row)) {
            return undefined;
          }
          const style = model.cellStyles?.[cellStyleKey(row, i)];
          if (!style) {
            return undefined;
          }
          const next: Record<string, string> = {
            fontWeight: style.bold ? "700" : "400",
            fontStyle: style.italic ? "italic" : "normal",
            textDecoration: style.underline ? "underline" : "none",
            textAlign: style.align ?? "left",
          };
          if (style.textColor) {
            next.color = style.textColor;
          }
          if (style.fillColor) {
            next.backgroundColor = style.fillColor;
          }
          return next;
        },
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

  const setCellRawValue = useCallback(
    (row: number, col: number, rawValue: string) => {
      if (row < 0 || col < 0 || row >= model.rows || col >= model.cols) {
        return;
      }
      const next = model.data.map((r) => [...r]);
      next[row][col] = rawValue;
      onModelChange({ ...model, data: next });
    },
    [model, onModelChange],
  );

  const getActiveCell = useCallback((): { row: number; col: number } | null => {
    if (selectedCell) {
      return selectedCell;
    }
    const focused = apiRef.current?.getFocusedCell();
    if (!focused) {
      return null;
    }
    const row = focused.rowIndex ?? -1;
    const focusedColId = focused.column?.getColId?.() ?? "";
    if (row < 0 || !focusedColId.startsWith("col")) {
      return null;
    }
    const col = Number(focusedColId.replace(/^col/, ""));
    if (!Number.isFinite(col) || col < 0) {
      return null;
    }
    return { row, col };
  }, [selectedCell]);

  const updateSelectedCellStyle = useCallback(
    (
      updater: (prev: SpreadsheetCellStyle) => SpreadsheetCellStyle | null,
      fallback?: { row: number; col: number },
    ) => {
      const target = selectedCell ?? fallback;
      if (!target) {
        return;
      }
      const key = cellStyleKey(target.row, target.col);
      const prev = model.cellStyles?.[key] ?? {};
      const next = updater(prev);
      const nextStyles = { ...(model.cellStyles ?? {}) };
      if (!next || Object.keys(next).length === 0) {
        delete nextStyles[key];
      } else {
        nextStyles[key] = next;
      }
      onModelChange({ ...model, cellStyles: nextStyles });
    },
    [model, onModelChange, selectedCell],
  );

  useEffect(() => {
    if (!selectedCell) {
      return;
    }
    const row = Math.max(0, Math.min(selectedCell.row, model.rows - 1));
    const col = Math.max(0, Math.min(selectedCell.col, model.cols - 1));
    if (row === selectedCell.row && col === selectedCell.col) {
      return;
    }
    setSelectedCell({ row, col });
  }, [model.cols, model.rows, selectedCell]);

  const insertRowAt = useCallback(
    (index: number) => {
      if (model.rows >= 200) {
        return;
      }
      const at = Math.max(0, Math.min(index, model.rows));
      const nextData = model.data.map((r) => [...r]);
      nextData.splice(
        at,
        0,
        Array.from({ length: model.cols }, () => ""),
      );
      onModelChange({ ...model, rows: model.rows + 1, data: nextData });
    },
    [model, onModelChange],
  );

  const deleteRowAt = useCallback(
    (index: number) => {
      if (model.rows <= 1 || index < 0 || index >= model.rows) {
        return;
      }
      const nextData = model.data.map((r) => [...r]);
      nextData.splice(index, 1);
      onModelChange({ ...model, rows: model.rows - 1, data: nextData });
    },
    [model, onModelChange],
  );

  const insertColAt = useCallback(
    (index: number) => {
      if (model.cols >= 100) {
        return;
      }
      const at = Math.max(0, Math.min(index, model.cols));
      const nextData = model.data.map((row) => {
        const nextRow = [...row];
        nextRow.splice(at, 0, "");
        return nextRow;
      });
      const nextWidths = [...(model.colWidths ?? [])];
      nextWidths.splice(at, 0, 0);
      onModelChange({
        ...model,
        cols: model.cols + 1,
        data: nextData,
        colWidths: nextWidths,
      });
    },
    [model, onModelChange],
  );

  const deleteColAt = useCallback(
    (index: number) => {
      if (model.cols <= 1 || index < 0 || index >= model.cols) {
        return;
      }
      const nextData = model.data.map((row) => row.filter((_, c) => c !== index));
      const nextWidths = (model.colWidths ?? []).filter((_, c) => c !== index);
      onModelChange({
        ...model,
        cols: model.cols - 1,
        data: nextData,
        colWidths: nextWidths,
      });
    },
    [model, onModelChange],
  );

  useEffect(() => {
    if (!selectedCell) {
      setFormulaInput("");
      return;
    }
    const value = model.data[selectedCell.row]?.[selectedCell.col] ?? "";
    setFormulaInput(String(value));
  }, [model, selectedCell]);

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

  const replaceModelWithMatrix = useCallback(
    (matrix: string[][]) => {
      const normalized = normalizeImportedMatrix(matrix);
      if (!normalized.length) {
        return;
      }
      const rows = Math.min(200, normalized.length);
      const cols = Math.min(100, Math.max(...normalized.map((r) => r.length), 1));
      const data = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => normalized[r]?.[c] ?? ""),
      );
      const colWidths = Array.from({ length: cols }, (_, i) => model.colWidths?.[i] ?? 0);
      onModelChange({
        ...model,
        rows,
        cols,
        data,
        colWidths,
        cellStyles: {},
      });
      setSelectedCell({ row: 0, col: 0 });
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

  const selectedCellLabel = selectedCell
    ? `${colName(selectedCell.col)}${selectedCell.row + 1}`
    : "-";
  const stopToolbarEvent = (
    ev: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>,
  ) => {
    ev.stopPropagation();
  };
  const stopCanvasToolEventCapture = (
    ev:
      | React.MouseEvent<HTMLDivElement>
      | React.PointerEvent<HTMLDivElement>
      | React.KeyboardEvent<HTMLDivElement>,
  ) => {
    // Prevent Excalidraw tools (eg. Text "A") from handling events inside
    // the spreadsheet surface. Cell editing should stay within the grid.
    ev.stopPropagation();
  };

  return (
    <div
      ref={hostRef}
      className="aim-sheet-grid ag-theme-quartz"
      onPasteCapture={handlePasteCapture}
      onPointerDownCapture={stopCanvasToolEventCapture}
      onPointerUpCapture={stopCanvasToolEventCapture}
      onDoubleClickCapture={stopCanvasToolEventCapture}
    >
      <div
        className="aim-sheet-toolbar"
        onPointerDown={stopToolbarEvent}
        onMouseDown={stopToolbarEvent}
      >
        <div className="aim-sheet-name-box" title="Active cell">
          {selectedCellLabel}
        </div>
        <label className="aim-sheet-formula-wrap" aria-label="Formula bar">
          <span className="aim-sheet-formula-fx">fx</span>
          <input
            type="text"
            className="aim-sheet-formula-input"
            value={formulaInput}
            placeholder="Enter value or formula like =SUM(A2:A7)"
            onPointerDown={stopToolbarEvent}
            onMouseDown={stopToolbarEvent}
            onChange={(ev) => setFormulaInput(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter" || !selectedCell) {
                return;
              }
              ev.preventDefault();
              setCellRawValue(selectedCell.row, selectedCell.col, formulaInput);
            }}
            onBlur={() => {
              if (!selectedCell) {
                return;
              }
              setCellRawValue(selectedCell.row, selectedCell.col, formulaInput);
            }}
          />
        </label>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => fileInputRef.current?.click()}
        >
          Open File
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => {
            const active = getActiveCell();
            if (active) {
              insertRowAt(active.row + 1);
              return;
            }
            insertRowAt(model.rows);
          }}
        >
          + Row
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => {
            const active = getActiveCell();
            if (!active) {
              return;
            }
            deleteRowAt(active.row);
          }}
        >
          - Row
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => {
            const active = getActiveCell();
            if (active) {
              insertColAt(active.col + 1);
              return;
            }
            insertColAt(model.cols);
          }}
        >
          + Col
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => {
            const active = getActiveCell();
            if (!active) {
              return;
            }
            deleteColAt(active.col);
          }}
        >
          - Col
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => {
            if (!selectedCell) {
              return;
            }
            setCellRawValue(selectedCell.row, selectedCell.col, "");
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => {
            apiRef.current?.exportDataAsCsv?.();
          }}
        >
          Export CSV
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          title="Bold"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() =>
            updateSelectedCellStyle((prev) => ({ ...prev, bold: !prev.bold }))
          }
        >
          B
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          title="Italic"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() =>
            updateSelectedCellStyle((prev) => ({ ...prev, italic: !prev.italic }))
          }
        >
          I
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          title="Underline"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() =>
            updateSelectedCellStyle((prev) => ({
              ...prev,
              underline: !prev.underline,
            }))
          }
        >
          U
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          title="Align left"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() => updateSelectedCellStyle((prev) => ({ ...prev, align: "left" }))}
        >
          <AlignIcon align="left" />
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          title="Align center"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() =>
            updateSelectedCellStyle((prev) => ({ ...prev, align: "center" }))
          }
        >
          <AlignIcon align="center" />
        </button>
        <button
          type="button"
          className="aim-sheet-toolbar-btn"
          title="Align right"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onClick={() =>
            updateSelectedCellStyle((prev) => ({ ...prev, align: "right" }))
          }
        >
          <AlignIcon align="right" />
        </button>
        <input
          type="color"
          className="aim-sheet-color-input"
          title="Text color"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onChange={(ev) =>
            updateSelectedCellStyle((prev) => ({ ...prev, textColor: ev.target.value }))
          }
        />
        <input
          type="color"
          className="aim-sheet-color-input"
          title="Fill color"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onChange={(ev) =>
            updateSelectedCellStyle((prev) => ({ ...prev, fillColor: ev.target.value }))
          }
        />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        onChange={async (ev) => {
          const file = ev.target.files?.[0];
          ev.currentTarget.value = "";
          if (!file) {
            return;
          }
          const lower = file.name.toLowerCase();
          if (lower.endsWith(".csv")) {
            const text = await file.text();
            replaceModelWithMatrix(parseClipboardTextToMatrix(text));
            return;
          }
          const buf = await file.arrayBuffer();
          const workbook = XLSX.read(buf, { type: "array" });
          const first = workbook.SheetNames[0];
          if (!first) {
            return;
          }
          const sheet = workbook.Sheets[first];
          const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          }) as unknown[][];
          const matrix = rows.map((row) => row.map((cell) => String(cell ?? "")));
          replaceModelWithMatrix(matrix);
        }}
      />
      <div className="aim-sheet-grid__body" ref={gridBodyRef}>
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
            setCellRawValue(row, col, evt.newValue == null ? "" : String(evt.newValue));
          }}
          onCellClicked={(evt: CellClickedEvent<RowValue>) => {
            const row = evt.rowIndex ?? -1;
            const field = typeof evt.colDef.field === "string" ? evt.colDef.field : "";
            if (row < 0 || !field.startsWith("col")) {
              return;
            }
            const col = Number(field.slice(3));
            if (!Number.isFinite(col) || col < 0 || col >= model.cols) {
              return;
            }
            setSelectedCell({ row, col });
          }}
          onCellFocused={(evt: CellFocusedEvent<RowValue>) => {
            const row = evt.rowIndex ?? -1;
            const colId =
              typeof evt.column === "string"
                ? evt.column
                : evt.column?.getColId?.() ?? "";
            if (row < 0 || !colId.startsWith("col")) {
              return;
            }
            const col = Number(colId.slice(3));
            if (!Number.isFinite(col) || col < 0 || col >= model.cols) {
              return;
            }
            setSelectedCell({ row, col });
          }}
          getContextMenuItems={(params: any) => {
            const colId =
              typeof params.column === "string"
                ? params.column
                : params.column?.getColId?.() ?? "";
            const rowIndex = Number.isFinite(params.node?.rowIndex)
              ? Number(params.node.rowIndex)
              : -1;
            const colIndex = colId.startsWith("col")
              ? Number(colId.slice(3))
              : -1;
            const items: any[] = [
              "copy",
              "paste",
              "separator",
              {
                name: "Insert row below",
                action: () => {
                  if (rowIndex >= 0) {
                    insertRowAt(rowIndex + 1);
                  }
                },
              },
              {
                name: "Delete row",
                action: () => {
                  if (rowIndex >= 0) {
                    deleteRowAt(rowIndex);
                  }
                },
              },
              {
                name: "Insert column right",
                action: () => {
                  if (colIndex >= 0) {
                    insertColAt(colIndex + 1);
                  }
                },
              },
              {
                name: "Delete column",
                action: () => {
                  if (colIndex >= 0) {
                    deleteColAt(colIndex);
                  }
                },
              },
              {
                name: "Clear cell",
                action: () => {
                  if (rowIndex >= 0 && colIndex >= 0) {
                    setCellRawValue(rowIndex, colIndex, "");
                  }
                },
              },
              "separator",
              "export",
            ];
            return items;
          }}
        />
      </div>
    </div>
  );
};
