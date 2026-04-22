import React, { useState } from "react";

import { Card } from "@excalidraw/excalidraw/components/Card";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { exportToCanvas } from "@excalidraw/excalidraw";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { AimtutorWordmark } from "./AimtutorWordmark";

// ── PDF export helper ─────────────────────────────────────────────────────────
const downloadAsPdf = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  name: string,
) => {
  const canvas = await exportToCanvas({
    elements,
    appState: {
      ...appState,
      exportBackground: true,
    },
    files,
    // Prevent extremely large canvases that can get clipped/partially rendered
    // in browser/canvas pipelines on some systems.
    maxWidthOrHeight: 4096,
  });

  const { jsPDF } = await import("jspdf");
  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.98);

  // Export into a standard paper size and fit the entire board within page bounds.
  // This avoids clipping/zoom caused by very large custom page dimensions.
  const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;

  const imageAspect = canvas.width / canvas.height;
  const pageAspect = availableWidth / availableHeight;

  let renderWidth = availableWidth;
  let renderHeight = availableHeight;

  if (imageAspect > pageAspect) {
    renderHeight = renderWidth / imageAspect;
  } else {
    renderWidth = renderHeight * imageAspect;
  }

  const x = (pageWidth - renderWidth) / 2;
  const y = (pageHeight - renderHeight) / 2;

  pdf.addImage(jpegDataUrl, "JPEG", x, y, renderWidth, renderHeight, undefined, "NONE");
  pdf.save(`${name || "board"}.pdf`);
};

// ── Re-exported for legacy callers (now a no-op Firebase stub) ────────────────
export const exportToExcalidrawPlus = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  name: string,
) => {
  await downloadAsPdf(elements, appState, files, name);
};

// ── Component ─────────────────────────────────────────────────────────────────
export const ExportToExcalidrawPlus: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name: string;
  /** Passed when on a cloud board (unused here but accepted for compat). */
  boardId?: string | null;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, files, name, onError, onSuccess }) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const btnLabel = done ? "✓ PDF ready!" : busy ? "Preparing PDF…" : "Download as PDF";

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadAsPdf(elements, appState, files, name);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
      onSuccess();
    } catch (error: any) {
      console.error(error);
      onError(new Error("Could not export to PDF. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card color="primary">
      <div className="Card-icon">
        <AimtutorWordmark variant="card" onPrimary />
      </div>
      <h2>aimtutor.ai+</h2>
      <div className="Card-details">
        Download your board as a PDF.
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title={btnLabel}
        aria-label={btnLabel}
        showAriaLabel={true}
        onClick={handleExport}
      />
    </Card>
  );
};
