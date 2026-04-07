/**
 * Socket.IO server base URL (scheme + host, no path). All collaborators must use
 * the same reachable URL (e.g. public https in production, localhost in dev).
 */
export function getCollabSocketServerUrl(): string {
  const rawWs =
    typeof import.meta.env.VITE_APP_WS_SERVER_URL === "string"
      ? import.meta.env.VITE_APP_WS_SERVER_URL.trim()
      : "";
  if (rawWs) {
    return rawWs.replace(/\/+$/, "");
  }

  const rawApi =
    typeof import.meta.env.VITE_APP_AI_BACKEND === "string"
      ? import.meta.env.VITE_APP_AI_BACKEND.trim()
      : "";
  if (!rawApi) {
    return "";
  }

  try {
    const u = new URL(rawApi);
    return `${u.protocol}//${u.host}`;
  } catch {
    return rawApi.replace(/\/+$/, "");
  }
}
