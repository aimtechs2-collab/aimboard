/**
 * REST client for personal workspace / folders / boards (ai-backend).
 */

export function getWorkspaceApiBase(): string {
  const b = import.meta.env.VITE_APP_AI_BACKEND;
  return typeof b === "string" ? b.replace(/\/$/, "") : "";
}

async function headersJson(getToken: () => Promise<string | null>) {
  const t = await getToken();
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (t) {
    h.Authorization = `Bearer ${t}`;
  }
  return h;
}

export type ApiWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiFolder = {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  boardCount?: number;
};

export type ApiBoardListItem = {
  id: string;
  folderId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  author: string | null;
};

export type ApiBoardDetail = {
  id: string;
  folderId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j?.message) {
        msg = j.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function listWorkspaces(
  getToken: () => Promise<string | null>,
): Promise<ApiWorkspace[]> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(`${base}/v1/workspaces`, {
    headers: await headersJson(getToken),
  });
  const data = await parseJson<{ workspaces: ApiWorkspace[] }>(res);
  return data.workspaces;
}

export async function createFolder(
  getToken: () => Promise<string | null>,
  workspaceId: string,
  name: string,
): Promise<ApiFolder> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/workspaces/${workspaceId}/folders`, {
    method: "POST",
    headers: await headersJson(getToken),
    body: JSON.stringify({ name }),
  });
  const data = await parseJson<{ folder: ApiFolder }>(res);
  return data.folder;
}

export async function listFolders(
  getToken: () => Promise<string | null>,
  workspaceId: string,
): Promise<ApiFolder[]> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/workspaces/${workspaceId}/folders`, {
    headers: await headersJson(getToken),
  });
  const data = await parseJson<{ folders: ApiFolder[] }>(res);
  return data.folders;
}

export async function deleteFolder(
  getToken: () => Promise<string | null>,
  folderId: string,
): Promise<void> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/folders/${folderId}`, {
    method: "DELETE",
    headers: await headersJson(getToken),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j?.message) {
        msg = j.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

export async function listBoardsInFolder(
  getToken: () => Promise<string | null>,
  folderId: string,
): Promise<ApiBoardListItem[]> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/folders/${folderId}/boards`, {
    headers: await headersJson(getToken),
  });
  const data = await parseJson<{ boards: ApiBoardListItem[] }>(res);
  return data.boards;
}

export async function createBoard(
  getToken: () => Promise<string | null>,
  folderId: string,
  title?: string,
): Promise<ApiBoardListItem> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/folders/${folderId}/boards`, {
    method: "POST",
    headers: await headersJson(getToken),
    body: JSON.stringify(title ? { title } : {}),
  });
  const data = await parseJson<{ board: ApiBoardListItem }>(res);
  return data.board;
}

export async function getBoardWithScene(
  getToken: () => Promise<string | null>,
  boardId: string,
): Promise<{ board: ApiBoardDetail; scene: Record<string, unknown> }> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/boards/${boardId}`, {
    headers: await headersJson(getToken),
  });
  return parseJson(res);
}

export async function putBoardScene(
  getToken: () => Promise<string | null>,
  boardId: string,
  body: {
    scene: Record<string, unknown>;
    title?: string;
    expectedUpdatedAt?: string | null;
  },
): Promise<{ board: ApiBoardDetail }> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/boards/${boardId}`, {
    method: "PUT",
    headers: await headersJson(getToken),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function renameFolder(
  getToken: () => Promise<string | null>,
  folderId: string,
  name: string,
): Promise<ApiFolder> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/folders/${folderId}`, {
    method: "PATCH",
    headers: await headersJson(getToken),
    body: JSON.stringify({ name }),
  });
  const data = await parseJson<{ folder: ApiFolder }>(res);
  return data.folder;
}

export async function reorderFolder(
  getToken: () => Promise<string | null>,
  folderId: string,
  sortOrder: number,
): Promise<ApiFolder> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/folders/${folderId}`, {
    method: "PATCH",
    headers: await headersJson(getToken),
    body: JSON.stringify({ sortOrder }),
  });
  const data = await parseJson<{ folder: ApiFolder }>(res);
  return data.folder;
}

export async function renameBoard(
  getToken: () => Promise<string | null>,
  boardId: string,
  title: string,
): Promise<ApiBoardListItem> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/boards/${boardId}`, {
    method: "PATCH",
    headers: await headersJson(getToken),
    body: JSON.stringify({ title }),
  });
  const data = await parseJson<{ board: ApiBoardListItem }>(res);
  return data.board;
}

export async function deleteBoard(
  getToken: () => Promise<string | null>,
  boardId: string,
): Promise<void> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/boards/${boardId}`, {
    method: "DELETE",
    headers: await headersJson(getToken),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j?.message) {
        msg = j.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

export async function renameWorkspace(
  getToken: () => Promise<string | null>,
  workspaceId: string,
  name: string,
): Promise<ApiWorkspace> {
  const base = getWorkspaceApiBase();
  const res = await fetch(`${base}/v1/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: await headersJson(getToken),
    body: JSON.stringify({ name }),
  });
  const data = await parseJson<{ workspace: ApiWorkspace }>(res);
  return data.workspace;
}

export type SidebarChatImage = {
  url: string;
  alt: string;
};

export type SidebarChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: SidebarChatImage[];
  /** Client-only: assistant turn was images-only mode (no streamed text). */
  imagesOnly?: boolean;
};

/** Strip client-only fields before sending to the AI backend. */
export function sidebarMessagesForApi(
  messages: SidebarChatMessage[],
): Array<{ role: "user" | "assistant"; content: string; images?: SidebarChatImage[] }> {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.role === "assistant" && m.images?.length
      ? { images: m.images }
      : {}),
  }));
}

/** Sidebar assistant behavior; must match ai-backend `parseSidebarChatMode`. */
export type SidebarChatMode = "topic_plus_images" | "images" | "chat";

/** OpenAI-backed chat; key stays on ai-backend (OPENAI_API_KEY). Requires Clerk JWT. */
export async function postSidebarChat(
  getToken: () => Promise<string | null>,
  messages: SidebarChatMessage[],
  mode: SidebarChatMode = "topic_plus_images",
): Promise<{ text: string; images: SidebarChatImage[] }> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(`${base}/v1/ai/sidebar-chat`, {
    method: "POST",
    headers: await headersJson(getToken),
    body: JSON.stringify({ messages, mode }),
  });
  const data = await parseJson<{
    text?: string;
    reply?: string;
    images?: SidebarChatImage[];
  }>(res);
  const text = data.text ?? data.reply ?? "";
  const images = Array.isArray(data.images) ? data.images : [];
  return { text, images };
}

export async function postSidebarChatStream(
  getToken: () => Promise<string | null>,
  messages: SidebarChatMessage[],
  options?: {
    mode?: SidebarChatMode;
    onChunk?: (chunk: string) => void;
    onImages?: (images: SidebarChatImage[]) => void;
    signal?: AbortSignal;
  },
): Promise<{ text: string; images: SidebarChatImage[] }> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${base}/v1/ai/sidebar-chat-streaming`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages,
      mode: options?.mode ?? "topic_plus_images",
    }),
    signal: options?.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed?.message) {
        msg = parsed.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response stream");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let fullResponse = "";
  let streamImages: SidebarChatImage[] = [];

  /** RAF-batch deltas so React can paint between frames (avoids one giant batched update). */
  let rafPending = "";
  let rafId: number | null = null;
  const flushRafChunk = () => {
    rafId = null;
    if (!options?.onChunk || !rafPending) {
      rafPending = "";
      return;
    }
    const chunk = rafPending;
    rafPending = "";
    options.onChunk(chunk);
  };
  const scheduleStreamChunk = (delta: string) => {
    fullResponse += delta;
    if (typeof requestAnimationFrame !== "function") {
      options?.onChunk?.(delta);
      return;
    }
    rafPending += delta;
    if (rafId == null) {
      rafId = requestAnimationFrame(flushRafChunk);
    }
  };
  const flushAllPendingChunks = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (rafPending && options?.onChunk) {
      options.onChunk(rafPending);
      rafPending = "";
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) {
        continue;
      }
      const data = trimmed.slice(6);
      if (data === "[DONE]") {
        flushAllPendingChunks();
        return { text: fullResponse, images: streamImages };
      }
      try {
        const parsed = JSON.parse(data) as
          | { type: "content"; delta?: string }
          | { type: "images"; images?: SidebarChatImage[] }
          | { type: "error"; error?: { message?: string } }
          | { type: "done" };
        if (parsed.type === "content" && parsed.delta) {
          scheduleStreamChunk(parsed.delta);
        }
        if (parsed.type === "images" && Array.isArray(parsed.images)) {
          streamImages = parsed.images
            .filter(
              (im) =>
                im &&
                typeof im.url === "string" &&
                im.url.startsWith("https://"),
            )
            .map((im) => ({
              url: im.url,
              alt:
                typeof im.alt === "string" && im.alt.trim()
                  ? im.alt
                  : "Reference image",
            })) as SidebarChatImage[];
          options?.onImages?.(streamImages);
        }
        if (parsed.type === "error") {
          throw new Error(parsed.error?.message || "Streaming request failed");
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          continue;
        }
        if (error instanceof Error) {
          throw error;
        }
      }
    }
  }
  flushAllPendingChunks();
  return { text: fullResponse, images: streamImages };
}

export type BoardAiChatSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export async function listBoardAiChats(
  getToken: () => Promise<string | null>,
  boardId: string,
): Promise<BoardAiChatSessionSummary[]> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(`${base}/v1/boards/${boardId}/ai-chats`, {
    headers: await headersJson(getToken),
  });
  const data = await parseJson<{ sessions: BoardAiChatSessionSummary[] }>(res);
  return data.sessions ?? [];
}

export async function getBoardAiChatSession(
  getToken: () => Promise<string | null>,
  boardId: string,
  sessionId: string,
): Promise<{
  session: Omit<BoardAiChatSessionSummary, "messageCount">;
  messages: SidebarChatMessage[];
  contextMessages: SidebarChatMessage[];
}> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(
    `${base}/v1/boards/${boardId}/ai-chats/${sessionId}`,
    { headers: await headersJson(getToken) },
  );
  return parseJson(res);
}

export async function deleteBoardAiChatSession(
  getToken: () => Promise<string | null>,
  boardId: string,
  sessionId: string,
): Promise<void> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(
    `${base}/v1/boards/${boardId}/ai-chats/${sessionId}`,
    {
      method: "DELETE",
      headers: await headersJson(getToken),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j?.message) {
        msg = j.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

export async function createBoardAiChatSession(
  getToken: () => Promise<string | null>,
  boardId: string,
  title?: string,
): Promise<{ session: BoardAiChatSessionSummary }> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(`${base}/v1/boards/${boardId}/ai-chats`, {
    method: "POST",
    headers: await headersJson(getToken),
    body: JSON.stringify(title ? { title } : {}),
  });
  return parseJson(res);
}

export async function putBoardAiChatSession(
  getToken: () => Promise<string | null>,
  boardId: string,
  sessionId: string,
  body: {
    title?: string;
    messages: SidebarChatMessage[];
    contextMessages: SidebarChatMessage[];
  },
): Promise<{ session: BoardAiChatSessionSummary }> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(
    `${base}/v1/boards/${boardId}/ai-chats/${sessionId}`,
    {
      method: "PUT",
      headers: await headersJson(getToken),
      body: JSON.stringify(body),
    },
  );
  return parseJson(res);
}
