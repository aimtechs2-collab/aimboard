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

export type SidebarChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/** OpenAI-backed chat; key stays on ai-backend (OPENAI_API_KEY). Requires Clerk JWT. */
export async function postSidebarChat(
  getToken: () => Promise<string | null>,
  messages: SidebarChatMessage[],
): Promise<string> {
  const base = getWorkspaceApiBase();
  if (!base) {
    throw new Error("VITE_APP_AI_BACKEND is not configured");
  }
  const res = await fetch(`${base}/v1/ai/sidebar-chat`, {
    method: "POST",
    headers: await headersJson(getToken),
    body: JSON.stringify({ messages }),
  });
  const data = await parseJson<{ reply: string }>(res);
  return data.reply ?? "";
}

export async function postSidebarChatStream(
  getToken: () => Promise<string | null>,
  messages: SidebarChatMessage[],
  options?: {
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
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
    body: JSON.stringify({ messages }),
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
        return fullResponse;
      }
      try {
        const parsed = JSON.parse(data) as
          | { type: "content"; delta?: string }
          | { type: "error"; error?: { message?: string } }
          | { type: "done" };
        if (parsed.type === "content" && parsed.delta) {
          fullResponse += parsed.delta;
          options?.onChunk?.(parsed.delta);
        }
        if (parsed.type === "error") {
          throw new Error(parsed.error?.message || "Streaming request failed");
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
      }
    }
  }
  return fullResponse;
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
