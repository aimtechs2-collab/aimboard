import { getFontEmbedCSS, toPng } from "html-to-image";

const IMAGE_URL_LINE_RE =
  /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\?[^\s]*)?$/i;

/** Remove Markdown images / bare image URLs; thumbnails are shown separately in the sidebar. */
export function stripEmbeddedReferenceImages(text: string): string {
  let s = text.replace(/\r/g, "");
  s = s.replace(/^\s*\d+\.\s*!\[[^\]]*\]\([^)\n]+\)\s*$/gm, "");
  s = s.replace(/^\s*[-*]\s+!\[[^\]]*\]\([^)\n]+\)\s*$/gm, "");
  s = s.replace(/!\[([^\]]*)\]\([^)\n]+\)/g, (_, alt) => {
    const t = String(alt).replace(/\s+/g, " ").trim();
    return t ? t : "";
  });
  s = s.replace(
    /\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/gi,
    (full, alt, url) => {
      const u = String(url).toLowerCase();
      if (
        IMAGE_URL_LINE_RE.test(u) ||
        /[?&]format=(png|jpe?g|webp|gif)/i.test(u) ||
        /\/(image|img|photo|diagram)\//i.test(u)
      ) {
        const t = String(alt).replace(/\s+/g, " ").trim();
        return t || "";
      }
      return full;
    },
  );
  s = s.replace(/^\s*https?:\/\/[^\s]+\s*$/gm, (line) => {
    const u = line.trim();
    return IMAGE_URL_LINE_RE.test(u) ? "" : line;
  });
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trimEnd();
}

/** Strip common Markdown so Excalidraw text paste looks readable (fallback / alt clipboard). */
export function markdownToBoardPlainText(raw: string): string {
  const src = stripEmbeddedReferenceImages(raw).replace(/\r/g, "");
  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBody: string[] = [];

  const flushCode = () => {
    if (!codeBody.length && !codeLang) {
      return;
    }
    if (codeLang) {
      out.push(`[${codeLang}]`);
    }
    out.push(codeBody.join("\n"));
    out.push("");
    codeBody = [];
    codeLang = "";
  };

  const splitTableCells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const isTableSeparator = (line: string) => {
    const cells = splitTableCells(line);
    return (
      cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    );
  };

  const isTableCandidate = (line: string) =>
    line.includes("|") && splitTableCells(line).length >= 2;

  const stripInlineMd = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([\w+-]+)?\s*$/);
    if (fenceMatch) {
      if (!inCode) {
        inCode = true;
        codeLang = fenceMatch[1] ?? "";
      } else {
        inCode = false;
        flushCode();
      }
      continue;
    }
    if (inCode) {
      codeBody.push(line);
      continue;
    }
    if (!trimmed) {
      out.push("");
      continue;
    }

    const nextTrimmed = (lines[lineIndex + 1] ?? "").trim();
    if (isTableCandidate(trimmed) && isTableSeparator(nextTrimmed)) {
      const headers = splitTableCells(trimmed).map(stripInlineMd);
      const rows: string[][] = [];
      let i = lineIndex + 2;
      while (i < lines.length) {
        const candidate = lines[i].trim();
        if (!candidate || !isTableCandidate(candidate)) {
          break;
        }
        rows.push(splitTableCells(candidate).map(stripInlineMd));
        i += 1;
      }
      out.push(headers.join("\t"));
      for (const row of rows) {
        out.push(row.join("\t"));
      }
      out.push("");
      lineIndex = i - 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const title = stripInlineMd(headingMatch[2]);
      const level = headingMatch[1].length;
      const prefix = level <= 2 ? "▎ " : "  ";
      out.push("");
      out.push(`${prefix}${title}`);
      out.push("");
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      out.push(`${orderedMatch[1]}. ${stripInlineMd(orderedMatch[2])}`);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      out.push(`• ${stripInlineMd(bulletMatch[1])}`);
      continue;
    }

    out.push(stripInlineMd(trimmed));
  }

  if (inCode) {
    inCode = false;
    flushCode();
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rasterize the live sidebar markdown DOM (clone) so paste on the board matches sidebar styling. */
export async function rasterizeAiMarkdownElement(
  sourceEl: HTMLElement,
): Promise<string | null> {
  if (!sourceEl) {
    return null;
  }
  /**
   * AppSidebar.scss nests `.aim-ai-chat__md` (and related rules) under `.excalidraw`.
   * Clones appended to `document.body` never match those selectors → unstyled / broken
   * layout and html-to-image often returns a blank white PNG.
   */
  const host = sourceEl.closest(".excalidraw") ?? document.body;

  const rect = sourceEl.getBoundingClientRect();
  const widthPx = Math.max(
    280,
    Math.min(560, Math.round(rect.width) || 480),
  );

  const wrap = document.createElement("div");
  wrap.className = "aim-ai-chat aim-ai-chat--raster-export";
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = [
    "position:fixed",
    "left:-12000px",
    "top:0",
    "z-index:2147483646",
    "pointer-events:none",
    "box-sizing:border-box",
    `width:${widthPx}px`,
    "max-width:560px",
    "padding:16px 20px",
    "background:#ffffff",
    /* Fallback if CSS variables are missing on this subtree */
    "color:#111827",
  ].join(";");

  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.classList.add("aim-ai-chat__md", "aim-ai-chat__md--clipboard-export");
  clone.style.visibility = "visible";
  clone.style.opacity = "1";
  clone
    .querySelectorAll(
      ".aim-ai-chat__math-snippet-bar, .aim-ai-chat__codeblock-header",
    )
    .forEach((n) => n.remove());

  wrap.appendChild(clone);
  host.appendChild(wrap);

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
    const pixelRatio = Math.min(
      2.5,
      (typeof window !== "undefined" ? window.devicePixelRatio : 1) * 1.5,
    );
    const pngOpts = {
      pixelRatio,
      cacheBust: true,
      backgroundColor: "#ffffff",
      preferredFontFormat: "woff2" as const,
    };
    let fontEmbedCSS: string | undefined;
    try {
      fontEmbedCSS = await getFontEmbedCSS(wrap, pngOpts);
    } catch {
      fontEmbedCSS = undefined;
    }
    let dataUrl: string;
    if (fontEmbedCSS) {
      dataUrl = await toPng(wrap, { ...pngOpts, fontEmbedCSS });
    } else {
      /* Same as KaTeX export: first pass often primes @font-face (e.g. KaTeX) for SVG raster. */
      await toPng(wrap, pngOpts);
      dataUrl = await toPng(wrap, pngOpts);
    }

    const h = wrap.scrollHeight;
    if (h < 12) {
      return null;
    }

    return dataUrl;
  } catch {
    return null;
  } finally {
    wrap.remove();
  }
}

async function isLikelyBlankWhiteImage(dataUrl: string): Promise<boolean> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("image decode failed"));
      next.src = dataUrl;
    });
    const w = Math.max(1, Math.min(160, img.naturalWidth));
    const h = Math.max(1, Math.min(160, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return false;
    }
    ctx.drawImage(img, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    let nonWhiteCount = 0;
    const total = w * h;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      if (a < 8) {
        continue;
      }
      if (!(r > 245 && g > 245 && b > 245)) {
        nonWhiteCount += 1;
      }
    }
    return nonWhiteCount < Math.max(20, Math.floor(total * 0.004));
  } catch {
    return false;
  }
}

function drawWrappedTextBlockToPng(text: string): string | null {
  const content = text.trim();
  if (!content) {
    return null;
  }
  const width = 900;
  const paddingX = 28;
  const paddingY = 24;
  const fontSize = 24;
  const lineHeight = 36;
  const fontFamily =
    "Inter, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif";
  const maxTextWidth = width - paddingX * 2;

  const mCanvas = document.createElement("canvas");
  const mCtx = mCanvas.getContext("2d");
  if (!mCtx) {
    return null;
  }
  mCtx.font = `${fontSize}px ${fontFamily}`;

  const lines: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\t/g, "    ");
    if (!line.trim()) {
      lines.push("");
      continue;
    }
    const words = line.split(/\s+/);
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (mCtx.measureText(next).width <= maxTextWidth) {
        cur = next;
      } else {
        if (cur) {
          lines.push(cur);
        }
        cur = word;
      }
    }
    if (cur) {
      lines.push(cur);
    }
  }

  const minHeight = 220;
  const height = Math.max(
    minHeight,
    paddingY * 2 + lineHeight * Math.max(1, lines.length),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";

  let y = paddingY;
  for (const line of lines) {
    if (line.length > 0) {
      ctx.fillText(line, paddingX, y);
    }
    y += lineHeight;
  }

  return canvas.toDataURL("image/png");
}

export async function copyAiAssistantReplyToClipboard(
  mdElement: HTMLElement | null | undefined,
  rawMarkdown: string,
  onToast: (msg: string) => void,
): Promise<void> {
  const plain = markdownToBoardPlainText(rawMarkdown);
  let png: string | null = null;
  if (mdElement) {
    png = await rasterizeAiMarkdownElement(mdElement);
  }
  if (png && (await isLikelyBlankWhiteImage(png))) {
    png = null;
  }
  if (!png) {
    png = drawWrappedTextBlockToPng(plain);
  }

  if (png && typeof ClipboardItem !== "undefined") {
    try {
      const res = await fetch(png);
      const pngBlob = await res.blob();
      const imageBlob =
        pngBlob.type === "image/png"
          ? pngBlob
          : new Blob([await pngBlob.arrayBuffer()], { type: "image/png" });
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": imageBlob,
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
        onToast("Copied (image + plain text for search)");
        return;
      } catch {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": imageBlob }),
          ]);
          onToast("Copied as formatted image");
          return;
        } catch {
          /* fall through */
        }
      }
    } catch {
      /* fall through */
    }
  }

  try {
    await navigator.clipboard.writeText(plain);
    onToast(png ? "Copied cleaned text (image copy blocked)" : "Copied cleaned text");
  } catch {
    onToast("Copy failed");
  }
}
