import {
  KEYS,
  AIMTUTOR_AI_CHAT_TAB,
  DEFAULT_SIDEBAR,
} from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { searchIcon } from "../components/icons";

import { register } from "./register";

import type { AppState } from "../types";

export const actionToggleSearchMenu = register({
  name: "searchMenu",
  icon: searchIcon,
  keywords: ["search", "find"],
  label: "search.title",
  viewMode: true,
  trackEvent: {
    category: "search_menu",
    action: "toggle",
    predicate: (appState) => appState.gridModeEnabled,
  },
  perform(elements, appState) {
    if (appState.openDialog) {
      return false;
    }

    return {
      appState: {
        ...appState,
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: AIMTUTOR_AI_CHAT_TAB },
        openDialog: null,
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  checked: (appState: AppState) => appState.gridModeEnabled,
  predicate: (element, appState, props) => {
    return props.gridModeEnabled === undefined;
  },
  keyTest: (event) => event[KEYS.CTRL_OR_CMD] && event.key === KEYS.F,
});
