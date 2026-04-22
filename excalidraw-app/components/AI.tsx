import {
  TTDDialog,
  TTDStreamFetch,
} from "@excalidraw/excalidraw";
import { RequestError } from "@excalidraw/excalidraw/errors";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { isClerkEnabled, useAppAuth } from "../auth/AppAuth";

import { TTDIndexedDBAdapter } from "../data/TTDStorage";

export const AIComponents = ({
  excalidrawAPI: _excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const { getToken, isLoaded, isSignedIn, openSignIn } = useAppAuth();

  return (
    <>
      <TTDDialog
        onTextSubmit={async (props) => {
          const { onChunk, onStreamCreated, signal, messages } = props;

          if (isClerkEnabled()) {
            if (!isLoaded) {
              return {
                error: new RequestError({
                  message:
                    "Checking sign-in… please wait a moment and try again.",
                  status: 401,
                }),
              };
            }
            if (!isSignedIn) {
              openSignIn();
              return {
                error: new RequestError({
                  message: "Sign in to use Text to diagram.",
                  status: 401,
                }),
              };
            }
            const token = await getToken();
            if (!token) {
              openSignIn();
              return {
                error: new RequestError({
                  message:
                    "Could not get a session token. Sign in and try again.",
                  status: 401,
                }),
              };
            }

            return TTDStreamFetch({
              url: `${
                import.meta.env.VITE_APP_AI_BACKEND
              }/v1/ai/text-to-diagram/chat-streaming`,
              messages,
              onChunk,
              onStreamCreated,
              extractRateLimits: true,
              signal,
              headers: { Authorization: `Bearer ${token}` },
            });
          }

          const token = await getToken();
          return TTDStreamFetch({
            url: `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/text-to-diagram/chat-streaming`,
            messages,
            onChunk,
            onStreamCreated,
            extractRateLimits: true,
            signal,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />
    </>
  );
};
