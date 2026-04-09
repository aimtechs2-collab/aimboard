import { useMemo } from "react";

import { DefaultSidebar } from "@excalidraw/excalidraw";
import { useTunnels } from "@excalidraw/excalidraw/context/tunnels";

import { AiSidebarChat, AiSidebarChatProvider } from "./AiSidebarChat";

import "./AppSidebar.scss";

/**
 * Host sidebar shell (replaces package fallback). Injects AI chat panel into
 * {@link packages/excalidraw/components/DefaultSidebar} via tunnel.
 */
export const AppSidebar = ({ boardId }: { boardId?: string | null }) => {
  const { AiChatSidebarTunnel } = useTunnels();
  /** Stable tunnel child so tunnel-rat does not remount the panel on every chat state update. */
  const tunnelChat = useMemo(() => <AiSidebarChat />, []);

  return (
    <AiSidebarChatProvider boardId={boardId ?? null}>
      <DefaultSidebar
        onDock={false}
        closeOnOutsideClick={false}
        closeOnEscape={false}
      />
      <AiChatSidebarTunnel.In>{tunnelChat}</AiChatSidebarTunnel.In>
    </AiSidebarChatProvider>
  );
};
