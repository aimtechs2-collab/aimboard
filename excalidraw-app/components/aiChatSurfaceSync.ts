/**
 * Lets {@link AiSidebarChat} re-render when chat state changes while the
 * tunnel-rat outlet keeps a stable `children` reference (avoids remounting the
 * whole panel on every message/stream chunk — which breaks Copy/Insert clicks).
 */
let surfaceVersion = 0;
const listeners = new Set<() => void>();

export function subscribeAiChatSurface(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getAiChatSurfaceSnapshot() {
  return surfaceVersion;
}

export function bumpAiChatSurface() {
  surfaceVersion += 1;
  for (const l of listeners) {
    l();
  }
}
