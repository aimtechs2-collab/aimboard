import React, { useMemo, useState } from "react";

const MAX_GRID = 20;

export const TablePicker: React.FC<{
  onSelect: (rows: number, cols: number) => void;
  onClose?: () => void;
}> = ({ onSelect, onClose }) => {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });

  const cells = useMemo(
    () =>
      Array.from({ length: MAX_GRID * MAX_GRID }, (_, i) => ({
        row: Math.floor(i / MAX_GRID) + 1,
        col: (i % MAX_GRID) + 1,
      })),
    [],
  );

  return (
    <div className="aim-table-picker" role="dialog" aria-label="Insert table">
      <div className="aim-table-picker__title">
        {hover.cols > 0 && hover.rows > 0
          ? `${hover.rows} x ${hover.cols}`
          : "Select table size"}
      </div>
      <div
        className="aim-table-picker__grid"
        style={{
          gridTemplateColumns: `repeat(${MAX_GRID}, 12px)`,
          gridTemplateRows: `repeat(${MAX_GRID}, 12px)`,
        }}
        onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
      >
        {cells.map(({ row, col }) => {
          const active = row <= hover.rows && col <= hover.cols;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
              className={`aim-table-picker__cell${active ? " is-active" : ""}`}
              aria-label={`${col} by ${row}`}
              onMouseEnter={() => setHover({ rows: row, cols: col })}
              onFocus={() => setHover({ rows: row, cols: col })}
              onClick={() => {
                onSelect(row, col);
                onClose?.();
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
