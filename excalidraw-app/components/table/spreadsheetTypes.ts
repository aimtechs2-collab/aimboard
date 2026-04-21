export const AIM_SPREADSHEET_LINK_PREFIX = "aimboard://spreadsheet";
export const AIM_SPREADSHEET_LINK = `${AIM_SPREADSHEET_LINK_PREFIX}/v1`;
export const AIM_SPREADSHEET_CUSTOM_KEY = "aimSpreadsheet" as const;

export type SpreadsheetCellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  textColor?: string;
  fillColor?: string;
};

export type SpreadsheetModel = {
  rows: number;
  cols: number;
  data: string[][];
  colWidths?: number[];
  cellStyles?: Record<string, SpreadsheetCellStyle>;
};

export type SpreadsheetCustomData = {
  model: SpreadsheetModel;
};

export const isSpreadsheetEmbedLink = (link: string | null | undefined) =>
  typeof link === "string" && link.startsWith(AIM_SPREADSHEET_LINK_PREFIX);

export const hasSpreadsheetCustomData = (
  customData: Record<string, unknown> | null | undefined,
) => {
  const value = customData?.[AIM_SPREADSHEET_CUSTOM_KEY];
  return Boolean(value && typeof value === "object");
};

export const clampSize = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export const buildEmptyModel = (rows: number, cols: number): SpreadsheetModel => {
  const safeRows = clampSize(rows, 1, 200);
  const safeCols = clampSize(cols, 1, 100);
  return {
    rows: safeRows,
    cols: safeCols,
    data: Array.from({ length: safeRows }, () =>
      Array.from({ length: safeCols }, () => ""),
    ),
    colWidths: Array.from({ length: safeCols }, () => 0),
  };
};

export const normalizeModel = (input?: Partial<SpreadsheetModel> | null) => {
  const rows = clampSize(input?.rows ?? 6, 1, 200);
  const cols = clampSize(input?.cols ?? 6, 1, 100);
  const data = Array.isArray(input?.data) ? input!.data! : [];
  const nextData = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const value = data[r]?.[c];
      return value == null ? "" : String(value);
    }),
  );
  const rawWidths = Array.isArray(input?.colWidths) ? input.colWidths : [];
  const colWidths = Array.from({ length: cols }, (_, i) => {
    const width = Number(rawWidths[i] ?? 0);
    return Number.isFinite(width) && width > 0 ? width : 0;
  });
  const rawCellStyles =
    input?.cellStyles && typeof input.cellStyles === "object" ? input.cellStyles : {};
  const cellStyles = Object.fromEntries(
    Object.entries(rawCellStyles).filter(([key, value]) => {
      if (!/^\d+:\d+$/.test(key)) {
        return false;
      }
      return Boolean(value && typeof value === "object");
    }),
  ) as Record<string, SpreadsheetCellStyle>;

  return { rows, cols, data: nextData, colWidths, cellStyles } satisfies SpreadsheetModel;
};
