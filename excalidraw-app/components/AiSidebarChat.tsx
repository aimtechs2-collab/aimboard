import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import katex from "katex";
import "katex/dist/katex.min.css";
import { getFontEmbedCSS, toPng } from "html-to-image";

import { Button } from "@excalidraw/excalidraw/components/Button";
import {
  historyIcon,
  PlusIcon,
  TrashIcon,
} from "@excalidraw/excalidraw/components/icons";
import { Tooltip } from "@excalidraw/excalidraw/components/Tooltip";
import { useTunnels } from "@excalidraw/excalidraw/context/tunnels";
import { t } from "@excalidraw/excalidraw/i18n";
import {
  convertToExcalidrawElements,
  MIME_TYPES,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";

import type { DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import { useAppAuth } from "../auth/AppAuth";
import {
  bumpAiChatSurface,
  getAiChatSurfaceSnapshot,
  subscribeAiChatSurface,
} from "./aiChatSurfaceSync";
import {
  createBoardAiChatSession,
  deleteBoardAiChatSession,
  getBoardAiChatSession,
  listBoardAiChats,
  postSidebarChatStream,
  putBoardAiChatSession,
  sidebarMessagesForApi,
  type BoardAiChatSessionSummary,
  type SidebarChatImage,
  type SidebarChatMessage,
  type SidebarChatMode,
} from "../data/workspaceApi";

import "./AppSidebar.scss";

/** Bound how much history we send; server also keeps the last 24 turns. */
const SIDEBAR_CHAT_MERGE_CAP = 48;
/** Max messages kept client-side across “New chat” archives (memory cap). */
const SIDEBAR_CONTEXT_STORE_CAP = 120;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 560;
const CHAT_HISTORY_MAX = 40;
const SIDEBAR_MODE_STORAGE_KEY = "aim-sidebar-chat-mode";
/** Shown reference thumbnails: Images mode fetches more from the API. */
const SIDEBAR_IMAGE_GRID_CAP_TOPIC = 4;
const SIDEBAR_IMAGE_GRID_CAP_IMAGES_ONLY = 10;

function readStoredSidebarMode(): SidebarChatMode {
  try {
    const v = localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
    if (v === "images" || v === "chat" || v === "topic_plus_images") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "topic_plus_images";
}

/** Drag reference thumbnails onto the canvas; must match App.tsx AIMBOARD_CHAT_IMAGE_DRAG_MIME. */
const AIMBOARD_CHAT_IMAGE_DRAG_MIME = "application/x-aimboard-chat-image";

const IMAGE_URL_LINE_RE =
  /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\?[^\s]*)?$/i;

/** Remove Markdown images / bare image URLs; thumbnails are shown separately in the sidebar. */
function stripEmbeddedReferenceImages(text: string): string {
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

/** Shown while the assistant reply is pending or still streaming. */
function AiChatTypingIndicator({ compact }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "aim-ai-chat__typing aim-ai-chat__typing--compact"
          : "aim-ai-chat__typing"
      }
      role="status"
      aria-live="polite"
      aria-label="Assistant is replying"
    >
      <span className="aim-ai-chat__typing-dot" />
      <span className="aim-ai-chat__typing-dot" />
      <span className="aim-ai-chat__typing-dot" />
    </div>
  );
}

type SavedChatSession = {
  id: string;
  title: string;
  messages: SidebarChatMessage[];
  contextMessages: SidebarChatMessage[];
  savedAt: number;
};

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sessionTitleFromMessages(session: SidebarChatMessage[]) {
  const firstUser = session.find((m) => m.role === "user")?.content?.trim() ?? "";
  const title = firstUser.replace(/\s+/g, " ").slice(0, 72);
  return title || "Chat";
}

const renderInline = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

/** Split `$$…$$` and `\[ … \]` display math from surrounding text. */
function splitDisplayParts(
  text: string,
): Array<{ type: "text" | "display"; value: string }> {
  const re = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g;
  const out: Array<{ type: "text" | "display"; value: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) });
    }
    const raw = m[1];
    let inner = raw;
    if (raw.startsWith("$$")) {
      inner = raw.slice(2, -2).trim();
    } else if (raw.startsWith("\\[")) {
      inner = raw.slice(2, -2).trim();
    }
    out.push({ type: "display", value: inner });
    last = re.lastIndex;
  }
  if (last < text.length) {
    out.push({ type: "text", value: text.slice(last) });
  }
  return out;
}

type MathSnippetActions = {
  onCopyCode: (text: string) => void;
  onInsertCode: (text: string) => void;
  onCopyMath: (args: {
    inner: string;
    displayMode: boolean;
    plainText: string;
  }) => void;
  onInsertMath: (args: { inner: string; displayMode: boolean }) => void;
};

function latexForCopyInline(inner: string) {
  return `\\(${inner}\\)`;
}

function latexForCopyDisplay(inner: string) {
  return `$$\n${inner}\n$$`;
}

function randomFileId(): FileId {
  const hex = [...crypto.getRandomValues(new Uint8Array(20))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex as FileId;
}

/** Rasterize KaTeX the same way it appears in the sidebar (for board / clipboard). */
async function rasterizeKatexToPng(
  inner: string,
  displayMode: boolean,
): Promise<string> {
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "z-index:-1",
    "background:#ffffff",
    "color:#1e1e1e",
    displayMode ? "padding:14px 18px" : "padding:6px 10px",
    displayMode ? "display:flex" : "display:inline-block",
    displayMode ? "justify-content:center" : "",
    "align-items:center",
  ]
    .filter(Boolean)
    .join(";");
  wrap.innerHTML = katex.renderToString(inner, {
    throwOnError: false,
    displayMode,
  });
  document.body.appendChild(wrap);
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    // KaTeX uses @font-face math fonts. html-to-image rasterizes via SVG where
    // those fonts often miss on the first pass → blank white PNG. Embedding
    // CSS fixes it; if that fails, a throwaway toPng primes the font cache.
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
    if (fontEmbedCSS) {
      return await toPng(wrap, { ...pngOpts, fontEmbedCSS });
    }
    await toPng(wrap, pngOpts);
    return await toPng(wrap, pngOpts);
  } finally {
    wrap.remove();
  }
}

function loadImageSize(
  dataUrl: string,
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;
  });
}

function renderInlineChunksWithMath(
  text: string,
  nextKey: () => string,
  nodes: React.ReactNode[],
  actions: MathSnippetActions,
) {
  const INLINE = /\\\(([\s\S]*?)\\\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={nextKey()}>{renderInline(text.slice(last, m.index))}</span>,
      );
    }
    const inner = m[1];
    const copyInsert = latexForCopyInline(inner);
    nodes.push(
      <span
        key={nextKey()}
        className="aim-ai-chat__math-snippet aim-ai-chat__math-snippet--inline"
      >
        <span className="aim-ai-chat__math-snippet-bar">
          <span className="aim-ai-chat__math-snippet-label">math</span>
          <span className="aim-ai-chat__math-snippet-actions">
            <button
              type="button"
              className="aim-ai-chat__math-snippet-btn"
              onClick={() =>
                actions.onCopyMath({
                  inner,
                  displayMode: false,
                  plainText: copyInsert,
                })
              }
            >
              Copy
            </button>
            <button
              type="button"
              className="aim-ai-chat__math-snippet-btn"
              onClick={() =>
                actions.onInsertMath({ inner, displayMode: false })
              }
            >
              Insert
            </button>
          </span>
        </span>
        <span
          className="aim-ai-chat__katex-inline"
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(inner, {
              throwOnError: false,
              displayMode: false,
            }),
          }}
        />
      </span>,
    );
    last = INLINE.lastIndex;
  }
  if (last < text.length) {
    nodes.push(
      <span key={nextKey()}>{renderInline(text.slice(last))}</span>,
    );
  }
}

function renderTextWithMath(
  text: string,
  keyPrefix: string,
  actions: MathSnippetActions,
): React.ReactNode {
  const keyRef = { n: 0 };
  const nextKey = () => `${keyPrefix}-${keyRef.n++}`;
  const nodes: React.ReactNode[] = [];
  for (const part of splitDisplayParts(text)) {
    if (part.type === "display") {
      const copyInsert = latexForCopyDisplay(part.value);
      nodes.push(
        <div
          key={nextKey()}
          className="aim-ai-chat__math-snippet aim-ai-chat__math-snippet--display"
        >
          <div className="aim-ai-chat__math-snippet-bar">
            <span className="aim-ai-chat__math-snippet-label">math</span>
            <span className="aim-ai-chat__math-snippet-actions">
              <button
                type="button"
                className="aim-ai-chat__math-snippet-btn"
                onClick={() =>
                  actions.onCopyMath({
                    inner: part.value,
                    displayMode: true,
                    plainText: copyInsert,
                  })
                }
              >
                Copy
              </button>
              <button
                type="button"
                className="aim-ai-chat__math-snippet-btn"
                onClick={() =>
                  actions.onInsertMath({
                    inner: part.value,
                    displayMode: true,
                  })
                }
              >
                Insert
              </button>
            </span>
          </div>
          <div
            className="aim-ai-chat__math-display-inner"
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.value, {
                throwOnError: false,
                displayMode: true,
              }),
            }}
          />
        </div>,
      );
    } else {
      renderInlineChunksWithMath(part.value, nextKey, nodes, actions);
    }
  }
  if (nodes.length === 0) {
    return null;
  }
  return nodes.length === 1 ? nodes[0] : <>{nodes}</>;
}

const renderAssistantMessage = (
  content: string,
  actions: MathSnippetActions,
) => {
  const lines = stripEmbeddedReferenceImages(content).replace(/\r/g, "").split("\n");
  const nodes: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: Array<{ text: string; order?: number }> = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    const text = paragraph.join(" ").trim();
    if (text) {
      nodes.push(
        <p key={`p-${nodes.length}`} className="aim-ai-chat__md-paragraph">
          {renderTextWithMath(text, `p-${nodes.length}`, actions)}
        </p>,
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    const Tag = listType;
    nodes.push(
      <Tag key={`list-${nodes.length}`} className="aim-ai-chat__md-list">
        {listItems.map((item, index) =>
          listType === "ol" ? (
            <li key={index} value={item.order}>
              {renderTextWithMath(item.text, `li-${nodes.length}-${index}`, actions)}
            </li>
          ) : (
            <li key={index}>
              {renderTextWithMath(item.text, `li-${nodes.length}-${index}`, actions)}
            </li>
          ),
        )}
      </Tag>,
    );
    listType = null;
    listItems = [];
  };

  const flushCodeBlock = () => {
    if (!codeLines.length && !codeLanguage) {
      return;
    }
    nodes.push(
      <div key={`code-${nodes.length}`} className="aim-ai-chat__codeblock">
        <div className="aim-ai-chat__codeblock-header">
          <div className="aim-ai-chat__codeblock-lang">
            {codeLanguage || "code"}
          </div>
          <div className="aim-ai-chat__codeblock-actions">
            <button
              type="button"
              className="aim-ai-chat__codeblock-action"
              onClick={() => actions.onCopyCode(codeLines.join("\n"))}
            >
              Copy
            </button>
            <button
              type="button"
              className="aim-ai-chat__codeblock-action"
              onClick={() => actions.onInsertCode(codeLines.join("\n"))}
            >
              Insert
            </button>
          </div>
        </div>
        <pre className="aim-ai-chat__codeblock-pre">
          <code>{codeLines.join("\n")}</code>
        </pre>
      </div>,
    );
    codeLines = [];
    codeLanguage = "";
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([\w+-]+)?\s*$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeLanguage = fenceMatch[1] ?? "";
      } else {
        inCodeBlock = false;
        flushCodeBlock();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const headingText = headingMatch[2].trim();
      nodes.push(
        <h4 key={`h-${nodes.length}`} className="aim-ai-chat__md-heading">
          {renderTextWithMath(headingText, `h-${nodes.length}`, actions)}
        </h4>,
      );
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push({
        order: Number(orderedMatch[1]),
        text: orderedMatch[2].trim(),
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push({ text: bulletMatch[1].trim() });
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (inCodeBlock) {
    inCodeBlock = false;
    flushCodeBlock();
  }

  if (nodes.length === 0) {
    const fallback = stripEmbeddedReferenceImages(content);
    return (
      <p className="aim-ai-chat__md-paragraph">
        {renderTextWithMath(fallback, "fallback", actions)}
      </p>
    );
  }
  return nodes;
};

type AiSidebarChatContextValue = {
  boardId: string | null;
  isSignedIn: boolean;
  messages: SidebarChatMessage[];
  loading: boolean;
  error: string | null;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pastSessions: SavedChatSession[];
  serverSessions: BoardAiChatSessionSummary[];
  restoreLocalSession: (session: SavedChatSession) => void;
  restoreServerSession: (sessionId: string) => Promise<void>;
  deleteServerSession: (sessionId: string) => Promise<void>;
  deleteLocalSession: (sessionId: string) => void;
  startNewChat: () => Promise<void>;
  send: () => Promise<void>;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCopyCode: (code: string) => Promise<void>;
  onInsertCode: (code: string) => void;
  onCopyMath: (args: {
    inner: string;
    displayMode: boolean;
    plainText: string;
  }) => Promise<void>;
  onInsertMath: (args: {
    inner: string;
    displayMode: boolean;
  }) => Promise<void>;
  onCopyAssistantReply: (text: string) => Promise<void>;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  chatRootRef: React.RefObject<HTMLDivElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  sidebarChatMode: SidebarChatMode;
  setSidebarChatMode: React.Dispatch<React.SetStateAction<SidebarChatMode>>;
};

const AiSidebarChatContext =
  React.createContext<AiSidebarChatContextValue | null>(null);

/** Keeps chat state alive while the AI sidebar is closed (tunnel Out unmounts). */
export const AiSidebarChatProvider: React.FC<{
  boardId: string | null;
  children: React.ReactNode;
}> = ({ boardId, children }) => {
  const { isSignedIn, getToken } = useAppAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const excalidrawAPI = useExcalidrawAPI();
  /** Prior “sessions” after New chat; still included in API requests. */
  const [contextMessages, setContextMessages] = useState<SidebarChatMessage[]>(
    [],
  );
  const [messages, setMessages] = useState<SidebarChatMessage[]>([]);
  const [pastSessions, setPastSessions] = useState<SavedChatSession[]>([]);
  const [serverSessions, setServerSessions] = useState<
    BoardAiChatSessionSummary[]
  >([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarChatMode, setSidebarChatMode] = useState<SidebarChatMode>(
    readStoredSidebarMode,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const chatRootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<SidebarChatMessage[]>([]);
  const contextMessagesRef = useRef<SidebarChatMessage[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  /** Latest SSE `images` payload (sync); avoids relying on messagesRef before React re-renders. */
  const sidebarStreamImagesRef = useRef<SidebarChatImage[]>([]);

  messagesRef.current = messages;
  contextMessagesRef.current = contextMessages;
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, sidebarChatMode);
    } catch {
      /* ignore */
    }
  }, [sidebarChatMode]);

  const refreshServerSessions = useCallback(async () => {
    if (!boardId) {
      return;
    }
    try {
      const list = await listBoardAiChats(getTokenRef.current, boardId);
      setServerSessions(list);
    } catch {
      /* ignore */
    }
  }, [boardId]);

  useEffect(() => {
    if (!isSignedIn) {
      setServerSessions([]);
      setActiveSessionId(null);
      activeSessionIdRef.current = null;
      setMessages([]);
      setContextMessages([]);
      return;
    }
    if (!boardId) {
      setServerSessions([]);
      setActiveSessionId(null);
      activeSessionIdRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sessions = await listBoardAiChats(getTokenRef.current, boardId);
        if (cancelled) {
          return;
        }
        setServerSessions(sessions);
        if (sessions.length === 0) {
          setMessages([]);
          setContextMessages([]);
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
          return;
        }
        const latest = sessions[0];
        const full = await getBoardAiChatSession(
          getTokenRef.current,
          boardId,
          latest.id,
        );
        if (cancelled) {
          return;
        }
        setActiveSessionId(full.session.id);
        activeSessionIdRef.current = full.session.id;
        setMessages(full.messages);
        setContextMessages(full.contextMessages);
      } catch {
        if (!cancelled) {
          setServerSessions([]);
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, isSignedIn]);

  const persistBoardSession = useCallback(
    async (
      sessionId: string,
      msgs: SidebarChatMessage[],
      ctx: SidebarChatMessage[],
    ) => {
      if (!boardId || !sessionId) {
        return;
      }
      try {
        await putBoardAiChatSession(getTokenRef.current, boardId, sessionId, {
          title: sessionTitleFromMessages(msgs),
          messages: msgs,
          contextMessages: ctx,
        });
        await refreshServerSessions();
      } catch {
        excalidrawAPI?.setToast({ message: "Could not save chat to server" });
      }
    },
    [boardId, refreshServerSessions, excalidrawAPI],
  );

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    bumpAiChatSurface();
  }, [
    messages,
    loading,
    error,
    input,
    historyOpen,
    isSignedIn,
    pastSessions,
    serverSessions,
  ]);

  const startNewChat = useCallback(async () => {
    const sessionPrev = messagesRef.current;
    const ctx = contextMessagesRef.current;
    const sid = activeSessionIdRef.current;

    if (boardId && sid && sessionPrev.length > 0) {
      await persistBoardSession(sid, sessionPrev, ctx);
    }

    if (!boardId && sessionPrev.length > 0) {
      setPastSessions((prev) => {
        const entry: SavedChatSession = {
          id: newSessionId(),
          title: sessionTitleFromMessages(sessionPrev),
          messages: sessionPrev.map((m) => ({ ...m })),
          contextMessages: ctx.map((m) => ({ ...m })),
          savedAt: Date.now(),
        };
        return [entry, ...prev].slice(0, CHAT_HISTORY_MAX);
      });
    }

    if (sessionPrev.length > 0) {
      setContextMessages(() => {
        const next = [...ctx, ...sessionPrev];
        return next.length > SIDEBAR_CONTEXT_STORE_CAP
          ? next.slice(-SIDEBAR_CONTEXT_STORE_CAP)
          : next;
      });
    }

    if (boardId) {
      try {
        const { session } = await createBoardAiChatSession(
          getTokenRef.current,
          boardId,
        );
        setActiveSessionId(session.id);
        activeSessionIdRef.current = session.id;
        await refreshServerSessions();
      } catch {
        setActiveSessionId(null);
        activeSessionIdRef.current = null;
        excalidrawAPI?.setToast({
          message: "Could not start new chat session",
        });
      }
    } else {
      setActiveSessionId(null);
      activeSessionIdRef.current = null;
    }

    setMessages([]);
    setError(null);
    setInput("");
  }, [boardId, persistBoardSession, refreshServerSessions, excalidrawAPI]);

  const restoreLocalSession = useCallback((session: SavedChatSession) => {
    const current = messagesRef.current;
    const ctxNow = contextMessagesRef.current;
    if (current.length > 0) {
      setPastSessions((prev) => {
        const entry: SavedChatSession = {
          id: newSessionId(),
          title: sessionTitleFromMessages(current),
          messages: current.map((m) => ({ ...m })),
          contextMessages: ctxNow.map((m) => ({ ...m })),
          savedAt: Date.now(),
        };
        return [entry, ...prev].slice(0, CHAT_HISTORY_MAX);
      });
    }
    setMessages(session.messages.map((m) => ({ ...m })));
    setContextMessages(session.contextMessages.map((m) => ({ ...m })));
    setHistoryOpen(false);
    setError(null);
    setInput("");
  }, []);

  const restoreServerSession = useCallback(
    async (sessionId: string) => {
      if (!boardId) {
        return;
      }
      const current = messagesRef.current;
      const ctxNow = contextMessagesRef.current;
      const curSid = activeSessionIdRef.current;
      if (curSid && current.length > 0) {
        await persistBoardSession(curSid, current, ctxNow);
      }
      try {
        const full = await getBoardAiChatSession(
          getTokenRef.current,
          boardId,
          sessionId,
        );
        setActiveSessionId(full.session.id);
        activeSessionIdRef.current = full.session.id;
        setMessages(full.messages.map((m) => ({ ...m })));
        setContextMessages(full.contextMessages.map((m) => ({ ...m })));
        setHistoryOpen(false);
        setError(null);
        setInput("");
        await refreshServerSessions();
      } catch {
        excalidrawAPI?.setToast({ message: "Could not open chat" });
      }
    },
    [boardId, persistBoardSession, refreshServerSessions, excalidrawAPI],
  );

  const deleteServerSession = useCallback(
    async (sessionId: string) => {
      if (!boardId) {
        return;
      }
      try {
        await deleteBoardAiChatSession(getTokenRef.current, boardId, sessionId);
      } catch {
        excalidrawAPI?.setToast({ message: "Could not delete chat" });
        return;
      }
      const wasActive = activeSessionIdRef.current === sessionId;
      let list: BoardAiChatSessionSummary[] = [];
      try {
        list = await listBoardAiChats(getTokenRef.current, boardId);
        setServerSessions(list);
      } catch {
        setServerSessions((prev) => prev.filter((s) => s.id !== sessionId));
        excalidrawAPI?.setToast({ message: "Could not refresh chat list" });
        if (wasActive) {
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
          setMessages([]);
          setContextMessages([]);
          setError(null);
          setInput("");
        }
        return;
      }

      if (!wasActive) {
        return;
      }

      if (list.length === 0) {
        setActiveSessionId(null);
        activeSessionIdRef.current = null;
        setMessages([]);
        setContextMessages([]);
        setError(null);
        setInput("");
        return;
      }

      const next = list[0];
      try {
        const full = await getBoardAiChatSession(
          getTokenRef.current,
          boardId,
          next.id,
        );
        setActiveSessionId(full.session.id);
        activeSessionIdRef.current = full.session.id;
        setMessages(full.messages.map((m) => ({ ...m })));
        setContextMessages(full.contextMessages.map((m) => ({ ...m })));
        setError(null);
        setInput("");
      } catch {
        setActiveSessionId(null);
        activeSessionIdRef.current = null;
        setMessages([]);
        setContextMessages([]);
        excalidrawAPI?.setToast({ message: "Could not load next chat" });
      }
    },
    [boardId, excalidrawAPI],
  );

  const deleteLocalSession = useCallback((sessionId: string) => {
    setPastSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !isSignedIn) {
      return;
    }

    let sid = activeSessionIdRef.current;
    if (boardId && !sid) {
      try {
        const { session } = await createBoardAiChatSession(
          getTokenRef.current,
          boardId,
          text.slice(0, 72),
        );
        sid = session.id;
        setActiveSessionId(session.id);
        activeSessionIdRef.current = session.id;
        await refreshServerSessions();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not start chat";
        setError(msg);
        return;
      }
    }

    setError(null);
    setInput("");
    const sessionPrior = messagesRef.current;
    const ctx = contextMessagesRef.current;
    const mergedBeforeUser = [...ctx, ...sessionPrior];
    const nextForApi: SidebarChatMessage[] = [
      ...mergedBeforeUser,
      { role: "user", content: text },
    ];
    const mergedForApi =
      nextForApi.length > SIDEBAR_CHAT_MERGE_CAP
        ? nextForApi.slice(-SIDEBAR_CHAT_MERGE_CAP)
        : nextForApi;
    const trimmedForApi = sidebarMessagesForApi(mergedForApi);

    const sessionWithUser: SidebarChatMessage[] = [
      ...sessionPrior,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(sessionWithUser);
    setLoading(true);
    sidebarStreamImagesRef.current = [];
    try {
      const { text: replyText, images: replyImages } =
        await postSidebarChatStream(getTokenRef.current, trimmedForApi, {
          mode: sidebarChatMode,
          onChunk: (chunk) => {
            setMessages((prev) => {
              const next = [...prev];
              const lastIndex = next.length - 1;
              if (lastIndex < 0 || next[lastIndex].role !== "assistant") {
                next.push({ role: "assistant", content: chunk });
                return next;
              }
              next[lastIndex] = {
                ...next[lastIndex],
                content: next[lastIndex].content + chunk,
              };
              return next;
            });
          },
          onImages: (images) => {
            sidebarStreamImagesRef.current = images.length ? [...images] : [];
            setMessages((prev) => {
              const next = [...prev];
              const lastIndex = next.length - 1;
              if (lastIndex < 0 || next[lastIndex].role !== "assistant") {
                return next;
              }
              next[lastIndex] = {
                ...next[lastIndex],
                images: images.length ? [...images] : undefined,
              };
              return next;
            });
          },
        });
      const persistId = activeSessionIdRef.current;
      const fallback = "I could not generate a response. Please try again.";
      const lastLive = messagesRef.current[messagesRef.current.length - 1];
      const imagesForFinal =
        replyImages.length > 0
          ? replyImages
          : sidebarStreamImagesRef.current.length > 0
            ? sidebarStreamImagesRef.current
            : lastLive?.role === "assistant" && lastLive.images?.length
              ? lastLive.images
              : [];
      const trimmedReply = replyText.trim();
      const assistantBody =
        trimmedReply ||
        (sidebarChatMode === "images" && imagesForFinal.length > 0
          ? ""
          : fallback);
      const imagesOnlyAssistant =
        sidebarChatMode === "images" &&
        !assistantBody.trim() &&
        imagesForFinal.length > 0;
      const finalThread: SidebarChatMessage[] = [
        ...sessionPrior,
        { role: "user", content: text },
        {
          role: "assistant",
          content: assistantBody,
          ...(imagesForFinal.length ? { images: imagesForFinal } : {}),
          ...(imagesOnlyAssistant ? { imagesOnly: true } : {}),
        },
      ];
      setMessages(finalThread);
      if (boardId && persistId) {
        await persistBoardSession(persistId, finalThread, ctx);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      setMessages(sessionPrior);
      setInput(text);
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    isSignedIn,
    boardId,
    persistBoardSession,
    refreshServerSessions,
    sidebarChatMode,
  ]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const sidebarEl = chatRootRef.current?.closest(".sidebar") as HTMLElement | null;
    if (!sidebarEl) {
      return;
    }
    const excalidrawEl = sidebarEl.closest(".excalidraw") as HTMLElement | null;
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarEl.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!resizeStateRef.current) {
        return;
      }
      const deltaX = resizeStateRef.current.startX - moveEvent.clientX;
      const nextWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, resizeStateRef.current.startWidth + deltaX),
      );
      if (excalidrawEl) {
        excalidrawEl.style.setProperty("--aim-right-sidebar-width", `${nextWidth}px`);
      }
    };

    const onPointerUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, []);

  const onCopyCode = useCallback(
    async (code: string) => {
      try {
        await navigator.clipboard.writeText(code);
        excalidrawAPI?.setToast({ message: "Copied" });
      } catch {
        excalidrawAPI?.setToast({ message: "Copy failed" });
      }
    },
    [excalidrawAPI],
  );

  const onCopyAssistantReply = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        excalidrawAPI?.setToast({ message: "Copied full reply" });
      } catch {
        excalidrawAPI?.setToast({ message: "Copy failed" });
      }
    },
    [excalidrawAPI],
  );

  const onInsertCode = useCallback(
    (code: string) => {
      if (!excalidrawAPI || !code.trim()) {
        return;
      }
      const appState = excalidrawAPI.getAppState();
      const zoom = appState.zoom.value || 1;
      const x = (appState.width * 0.72 - appState.scrollX) / zoom;
      const y = (appState.height * 0.24 - appState.scrollY) / zoom;
      const [newElement] = convertToExcalidrawElements([
        {
          type: "text",
          x,
          y,
          text: code,
          fontSize: 16,
          width: 480,
        },
      ]);
      const existingElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      excalidrawAPI.updateScene({
        elements: [...existingElements, newElement],
        appState: {
          selectedElementIds: {
            [newElement.id]: true,
          },
        },
      });
      excalidrawAPI.setToast({ message: "Inserted on board" });
    },
    [excalidrawAPI],
  );

  const onCopyMath = useCallback(
    async ({
      inner,
      displayMode,
      plainText,
    }: {
      inner: string;
      displayMode: boolean;
      plainText: string;
    }) => {
      try {
        const dataUrl = await rasterizeKatexToPng(inner, displayMode);
        const res = await fetch(dataUrl);
        const pngBlob = await res.blob();
        if (typeof ClipboardItem !== "undefined") {
          const imageBlob =
            pngBlob.type === MIME_TYPES.png
              ? pngBlob
              : new Blob([await pngBlob.arrayBuffer()], {
                  type: MIME_TYPES.png,
                });
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                "image/png": imageBlob,
                "text/plain": new Blob([plainText], {
                  type: "text/plain",
                }),
              }),
            ]);
            excalidrawAPI?.setToast({ message: "Copied (image + LaTeX)" });
            return;
          } catch {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ "image/png": imageBlob }),
              ]);
              excalidrawAPI?.setToast({ message: "Copied as image" });
              return;
            } catch {
              /* fall through to text */
            }
          }
        }
        await navigator.clipboard.writeText(plainText);
        excalidrawAPI?.setToast({ message: "Copied LaTeX" });
      } catch {
        try {
          await navigator.clipboard.writeText(plainText);
          excalidrawAPI?.setToast({ message: "Copied LaTeX" });
        } catch {
          excalidrawAPI?.setToast({ message: "Copy failed" });
        }
      }
    },
    [excalidrawAPI],
  );

  const onInsertMath = useCallback(
    async ({
      inner,
      displayMode,
    }: {
      inner: string;
      displayMode: boolean;
    }) => {
      if (!excalidrawAPI) {
        return;
      }
      try {
        const dataUrl = await rasterizeKatexToPng(inner, displayMode);
        const { naturalWidth, naturalHeight } = await loadImageSize(dataUrl);
        const fileId = randomFileId();
        const appState = excalidrawAPI.getAppState();
        const zoom = appState.zoom.value || 1;
        const x = (appState.width * 0.72 - appState.scrollX) / zoom;
        const y = (appState.height * 0.24 - appState.scrollY) / zoom;
        const maxSceneW = displayMode ? 420 : 300;
        const scale = Math.min(1, maxSceneW / naturalWidth);
        const elW = naturalWidth * scale;
        const elH = naturalHeight * scale;

        excalidrawAPI.addFiles([
          {
            id: fileId,
            mimeType: MIME_TYPES.png,
            dataURL: dataUrl as DataURL,
            created: Date.now(),
            lastRetrieved: Date.now(),
          },
        ]);

        const [newElement] = convertToExcalidrawElements([
          {
            type: "image",
            x,
            y,
            width: elW,
            height: elH,
            fileId,
            status: "saved",
          },
        ]);
        const existingElements = excalidrawAPI.getSceneElementsIncludingDeleted();
        excalidrawAPI.updateScene({
          elements: [...existingElements, newElement],
          appState: {
            selectedElementIds: {
              [newElement.id]: true,
            },
          },
        });
        excalidrawAPI.refresh();
        excalidrawAPI.setToast({ message: "Inserted formula on board" });
      } catch {
        excalidrawAPI.setToast({ message: "Could not insert formula" });
      }
    },
    [excalidrawAPI],
  );

  const value: AiSidebarChatContextValue = {
    boardId,
    isSignedIn,
    messages,
    loading,
    error,
    input,
    setInput,
    historyOpen,
    setHistoryOpen,
    pastSessions,
    serverSessions,
    restoreLocalSession,
    restoreServerSession,
    deleteServerSession,
    deleteLocalSession,
    startNewChat,
    send,
    onKeyDown,
    onCopyCode,
    onInsertCode,
    onCopyMath,
    onInsertMath,
    onCopyAssistantReply,
    onResizeStart,
    chatRootRef,
    listRef,
    sidebarChatMode,
    setSidebarChatMode,
  };

  return (
    <AiSidebarChatContext.Provider value={value}>
      {children}
    </AiSidebarChatContext.Provider>
  );
};

export const AiSidebarChat: React.FC = () => {
  useSyncExternalStore(
    subscribeAiChatSurface,
    getAiChatSurfaceSnapshot,
    getAiChatSurfaceSnapshot,
  );
  useLayoutEffect(() => {
    bumpAiChatSurface();
  }, []);
  const ctx = React.useContext(AiSidebarChatContext);
  if (!ctx) {
    throw new Error("AiSidebarChat must be used within AiSidebarChatProvider");
  }
  const {
    boardId,
    isSignedIn,
    messages,
    loading,
    error,
    input,
    setInput,
    historyOpen,
    setHistoryOpen,
    pastSessions,
    serverSessions,
    restoreLocalSession,
    restoreServerSession,
    deleteServerSession,
    deleteLocalSession,
    startNewChat,
    send,
    onKeyDown,
    onCopyCode,
    onInsertCode,
    onCopyMath,
    onInsertMath,
    onCopyAssistantReply,
    onResizeStart,
    chatRootRef,
    listRef,
    sidebarChatMode,
    setSidebarChatMode,
  } = ctx;
  const { AiSidebarHeaderActionsTunnel } = useTunnels();

  if (!isSignedIn) {
    return (
      <div className="aim-ai-chat aim-ai-chat--gate">
        <p className="aim-ai-chat__gate-text">
          Sign in to chat with the AI assistant. Your OpenAI key stays on the
          server; the browser only talks to your AimTutor API.
        </p>
      </div>
    );
  }

  return (
    <>
      <AiSidebarHeaderActionsTunnel.In>
        <div className="aim-ai-sidebar-header-actions">
          <div className="aim-ai-chat-mode-wrap">
            <label className="aim-ai-chat-mode-label" htmlFor="aim-sidebar-chat-mode">
              Mode
            </label>
            <select
              id="aim-sidebar-chat-mode"
              className="aim-ai-chat-mode-select"
              value={sidebarChatMode}
              onChange={(e) =>
                setSidebarChatMode(e.target.value as SidebarChatMode)
              }
              aria-label="Assistant mode: images, topic with images, or chat"
              disabled={loading}
            >
              <option value="images">Images</option>
              <option value="topic_plus_images">Topic + images</option>
              <option value="chat">Chat</option>
            </select>
          </div>
          <Tooltip label={t("labels.aiChatHistory")}>
            <Button
              type="button"
              onSelect={() => setHistoryOpen(true)}
              className="sidebar__dock aim-ai-history"
              data-testid="ai-sidebar-chat-history"
              aria-label={t("labels.aiChatHistory")}
            >
              {historyIcon}
            </Button>
          </Tooltip>
          <Tooltip label={t("labels.aiNewChat")}>
            <Button
              type="button"
              onSelect={startNewChat}
              className="sidebar__dock aim-ai-new-chat"
              data-testid="ai-sidebar-new-chat"
              aria-label={t("labels.aiNewChat")}
            >
              {PlusIcon}
            </Button>
          </Tooltip>
        </div>
      </AiSidebarHeaderActionsTunnel.In>
      <div ref={chatRootRef} className="aim-ai-chat">
        <button
          type="button"
          className="aim-ai-chat__resize-handle"
          onPointerDown={onResizeStart}
          aria-label="Resize sidebar"
          title="Drag to resize sidebar"
        >
          <span />
        </button>
        {historyOpen && (
          <div
            className="aim-ai-chat__history-backdrop"
            role="presentation"
            onClick={() => setHistoryOpen(false)}
          >
            <div
              className="aim-ai-chat__history-panel"
              role="dialog"
              aria-labelledby="aim-ai-chat-history-heading"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="aim-ai-chat__history-header">
                <h2 id="aim-ai-chat-history-heading" className="aim-ai-chat__history-title">
                  {t("labels.aiChatHistory")}
                </h2>
                <button
                  type="button"
                  className="aim-ai-chat__history-close"
                  onClick={() => setHistoryOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="aim-ai-chat__history-list" role="list">
                {boardId ? (
                  serverSessions.length === 0 ? (
                    <p className="aim-ai-chat__history-empty">
                      No saved chats on this board yet. Send a message or use + for a
                      new thread—conversations are saved automatically.
                    </p>
                  ) : (
                    serverSessions.map((s) => (
                      <div
                        key={s.id}
                        className="aim-ai-chat__history-row"
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="aim-ai-chat__history-item-main"
                          onClick={() => void restoreServerSession(s.id)}
                        >
                          <span className="aim-ai-chat__history-item-title">
                            {s.title}
                          </span>
                          <span className="aim-ai-chat__history-item-meta">
                            <time dateTime={s.updatedAt}>
                              {new Date(s.updatedAt).toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </time>
                            {s.messageCount > 0 ? (
                              <>
                                <span
                                  className="aim-ai-chat__history-item-meta-sep"
                                  aria-hidden
                                >
                                  ·
                                </span>
                                <span>
                                  {s.messageCount}{" "}
                                  {s.messageCount === 1 ? "message" : "messages"}
                                </span>
                              </>
                            ) : null}
                          </span>
                        </button>
                        <div className="aim-ai-chat__history-delete-wrap">
                          <Tooltip label="Delete chat">
                            <button
                              type="button"
                              className="aim-ai-chat__history-item-delete"
                              aria-label="Delete chat"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteServerSession(s.id);
                              }}
                            >
                              {TrashIcon}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    ))
                  )
                ) : pastSessions.length === 0 ? (
                  <p className="aim-ai-chat__history-empty">
                    Past chats appear here after you start a new thread with +. Open
                    one to continue that conversation. On a saved board, history syncs
                    to your account.
                  </p>
                ) : (
                  pastSessions.map((s) => (
                    <div
                      key={s.id}
                      className="aim-ai-chat__history-row"
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="aim-ai-chat__history-item-main"
                        onClick={() => restoreLocalSession(s)}
                      >
                        <span className="aim-ai-chat__history-item-title">
                          {s.title}
                        </span>
                        <span className="aim-ai-chat__history-item-meta">
                          <time dateTime={new Date(s.savedAt).toISOString()}>
                            {new Date(s.savedAt).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                          <span
                            className="aim-ai-chat__history-item-meta-sep"
                            aria-hidden
                          >
                            ·
                          </span>
                          <span>Saved locally</span>
                        </span>
                      </button>
                      <div className="aim-ai-chat__history-delete-wrap">
                        <Tooltip label="Delete chat">
                          <button
                            type="button"
                            className="aim-ai-chat__history-item-delete"
                            aria-label="Delete chat"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteLocalSession(s.id);
                            }}
                          >
                            {TrashIcon}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={listRef} className="aim-ai-chat__messages">
          {messages.length === 0 && !loading && (
            <p className="aim-ai-chat__empty">
              Name a subject or unit (e.g. statistics and probability). You will
              get an ordered list of teachable topics and subtopics for your
              sessions. Use + for a clean thread on screen—earlier turns stay
              in context for the AI. You can also ask about the board or a
              specific lesson question.
            </p>
          )}
          {messages.map((m, i) => {
            const isAssistant = m.role === "assistant";
            const replyComplete =
              !isAssistant ||
              !loading ||
              i < messages.length - 1;
            const showCopyFullReply =
              isAssistant && m.content.trim() && replyComplete;
            const isStreamingAssistant =
              loading && isAssistant && i === messages.length - 1;
            const hasAssistantText = m.content.trim().length > 0;
            const hasAssistantImages = (m.images?.length ?? 0) > 0;
            const showPlaceholderTyping =
              isStreamingAssistant &&
              !hasAssistantText &&
              !hasAssistantImages;
            const showTypingTail =
              isStreamingAssistant &&
              (hasAssistantText || hasAssistantImages);
            return (
              <div
                key={i}
                className={`aim-ai-chat__bubble aim-ai-chat__bubble--${m.role}`}
              >
                {isAssistant ? (
                  <>
                    {showPlaceholderTyping && <AiChatTypingIndicator />}
                    {m.imagesOnly &&
                      hasAssistantImages &&
                      !hasAssistantText && (
                        <p className="aim-ai-chat__images-only-hint">
                          Reference images
                        </p>
                      )}
                    {hasAssistantText && (
                      <div className="aim-ai-chat__md">
                        {renderAssistantMessage(m.content, {
                          onCopyCode,
                          onInsertCode,
                          onCopyMath,
                          onInsertMath,
                        })}
                      </div>
                    )}
                    {m.images && m.images.length > 0 && (
                      <div
                        className="aim-ai-chat__illustrations"
                        aria-label="Reference images"
                      >
                        {m.images
                          .slice(
                            0,
                            m.imagesOnly
                              ? SIDEBAR_IMAGE_GRID_CAP_IMAGES_ONLY
                              : SIDEBAR_IMAGE_GRID_CAP_TOPIC,
                          )
                          .map((im, idx) => (
                          <div
                            key={`${im.url}-${idx}`}
                            role="button"
                            tabIndex={0}
                            className="aim-ai-chat__illustrations-item"
                            title={
                              im.alt
                                ? `${im.alt} — drag to board or click to open`
                                : "Drag to board or click to open"
                            }
                            aria-label={
                              im.alt
                                ? `${im.alt} (drag to canvas or open in new tab)`
                                : "Reference image — drag to canvas or open in new tab"
                            }
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                AIMBOARD_CHAT_IMAGE_DRAG_MIME,
                                JSON.stringify({
                                  url: im.url,
                                  alt: im.alt ?? "",
                                }),
                              );
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            onClick={() =>
                              window.open(
                                im.url,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                window.open(
                                  im.url,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              }
                            }}
                          >
                            <img
                              src={im.url}
                              alt={im.alt || "Reference image"}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {showTypingTail && <AiChatTypingIndicator compact />}
                    {showCopyFullReply && (
                      <div className="aim-ai-chat__response-footer">
                        <button
                          type="button"
                          className="aim-ai-chat__response-copy"
                          onClick={() =>
                            void onCopyAssistantReply(
                              stripEmbeddedReferenceImages(m.content),
                            )
                          }
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  m.content
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <div className="aim-ai-chat__error" role="alert">
            {error}
          </div>
        )}
        <div className="aim-ai-chat__composer">
          <textarea
            className="aim-ai-chat__input"
            rows={3}
            placeholder="Message…"
            value={input}
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="aim-ai-chat__send"
            disabled={loading || !input.trim()}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
};
