import {
  observeAiGenerationSeconds,
  observeOpenAiSeconds,
  recordAiGenerationFailure,
} from "../utils/prometheus.mjs";

export function createAiController(deps) {
  const {
    requireDatabase,
    requireAuthApi,
    requireAiProvider,
    upsertUserFromAuth,
    parseAiProvider,
    parseAiModel,
    createOpenAIClient,
    ollamaChatStreaming,
    ollamaChatNonStreaming,
    OLLAMA_BASE_URL,
    OLLAMA_TIMEOUT_MS,
    MODEL,
    VISION_MODEL,
    MERMAID_SYSTEM,
    logUsage,
    publicErrorMessage,
    parseSidebarChatMode,
    buildSidebarOpenAIMessages,
    runSidebarImagePipeline,
    SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
    SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
  } = deps;

  return {
    async listOllamaModels(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      if (!requireAiProvider(res, "ollama")) return;
      const localUserId = await upsertUserFromAuth(auth);
      const genStart = process.hrtime.bigint();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
        const resp = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Ollama tags failed (${resp.status}): ${body}`);
        }
        const data = await resp.json();
        const names = Array.isArray(data?.models)
          ? data.models
              .map((m) => String(m?.name ?? "").trim())
              .filter(Boolean)
              .slice(0, 128)
          : [];
        res.locals.auditDetails = {
          kind: "ai_ollama_models",
          provider: "ollama",
          modelCount: names.length,
        };
        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/ollama/models",
          model: "ollama:tags",
        });
        observeAiGenerationSeconds(
          "ollama_models",
          "ollama",
          Number(process.hrtime.bigint() - genStart) / 1e9,
          true,
        );
        res.json({ models: names });
      } catch (err) {
        observeAiGenerationSeconds(
          "ollama_models",
          "ollama",
          Number(process.hrtime.bigint() - genStart) / 1e9,
          false,
        );
        recordAiGenerationFailure("ollama_models", "ollama");
        res.locals.auditError = err?.message || "Failed to load ollama models";
        res.status(500).json({ message: publicErrorMessage(err) });
      }
    },

    async textToDiagramStreaming(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;

      const { messages } = req.body ?? {};
      if (!Array.isArray(messages)) {
        res.locals.auditError = "body.messages must be an array";
        res.status(400).json({ message: "body.messages must be an array" });
        return;
      }
      const provider = parseAiProvider(req.body);
      if (!requireAiProvider(res, provider)) return;
      const model = parseAiModel(req.body, provider, MODEL);
      const localUserId = await upsertUserFromAuth(auth);
      const openai = provider === "openai" ? createOpenAIClient() : null;

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const sendSse = (obj) => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      const genStart = process.hrtime.bigint();
      try {
        const normalizedMessages = [
          { role: "system", content: MERMAID_SYSTEM },
          ...messages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content ?? ""),
          })),
        ];

        let promptTokens = null;
        let completionTokens = null;
        let emittedContent = false;
        if (provider === "ollama") {
          for await (const delta of ollamaChatStreaming({
            model,
            messages: normalizedMessages,
            maxTokens: 2048,
            temperature: 0.7,
          })) {
            if (delta) {
              sendSse({ type: "content", delta });
              emittedContent = true;
            }
          }
          if (!emittedContent) {
            const fallbackText = await ollamaChatNonStreaming({
              model,
              messages: normalizedMessages,
              maxTokens: 2048,
              temperature: 0.7,
            });
            if (fallbackText) {
              sendSse({ type: "content", delta: fallbackText });
              emittedContent = true;
            }
          }
        } else {
          const tOpenAi = process.hrtime.bigint();
          const stream = await openai.chat.completions.create({
            model,
            stream: true,
            messages: normalizedMessages,
          });
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            promptTokens = chunk?.usage?.prompt_tokens ?? promptTokens;
            completionTokens = chunk?.usage?.completion_tokens ?? completionTokens;
            if (delta) {
              sendSse({ type: "content", delta });
              emittedContent = true;
            }
          }
          observeOpenAiSeconds(
            "text_to_diagram_stream",
            Number(process.hrtime.bigint() - tOpenAi) / 1e9,
          );
        }

        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/text-to-diagram/chat-streaming",
          model,
          promptTokens,
          completionTokens,
        });

        res.locals.auditDetails = {
          kind: "ai_text_to_diagram_stream",
          provider,
          model,
          promptTokens,
          completionTokens,
          messageCount: messages.length,
        };

        observeAiGenerationSeconds(
          "text_to_diagram_stream",
          provider,
          Number(process.hrtime.bigint() - genStart) / 1e9,
          true,
        );
        sendSse({ type: "done", finishReason: "stop" });
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (err) {
        observeAiGenerationSeconds(
          "text_to_diagram_stream",
          provider,
          Number(process.hrtime.bigint() - genStart) / 1e9,
          false,
        );
        recordAiGenerationFailure("text_to_diagram_stream", provider);
        const internal = err?.message || "OpenAI request failed";
        res.locals.auditError = internal;
        res.locals.auditDetails = {
          kind: "ai_text_to_diagram_stream",
          provider,
          model,
          failed: true,
        };
        sendSse({
          type: "error",
          error: {
            message: publicErrorMessage(err),
            status: err?.status ?? 500,
          },
        });
        res.end();
      }
    },

    async sidebarChatStreaming(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);

      const { messages } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.locals.auditError = "sidebar-chat-streaming: messages required";
        res.status(400).json({ message: "body.messages must be a non-empty array" });
        return;
      }

      const trimmed = messages
        .slice(-24)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? "").slice(0, 12000),
        }))
        .filter((m) => m.content.length > 0);

      if (!trimmed.length) {
        res.locals.auditError = "sidebar-chat-streaming: empty content";
        res.status(400).json({ message: "No valid message content" });
        return;
      }

      const provider = parseAiProvider(req.body);
      if (!requireAiProvider(res, provider)) return;
      const model = parseAiModel(req.body, provider, MODEL);
      const openai = provider === "openai" ? createOpenAIClient() : null;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const sendSse = (obj) => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      const mode = parseSidebarChatMode(req.body);
      const genStart = process.hrtime.bigint();

      try {
        let promptTokens = null;
        let completionTokens = null;
        let emittedContent = false;

        if (mode === "images") {
          const { items, expansionUsage } = await runSidebarImagePipeline({
            provider,
            openai,
            model,
            trimmed,
            maxReferenceImages: SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
          });
          if (items.length > 0 && !res.writableEnded) {
            sendSse({ type: "images", images: items });
          }
          if (expansionUsage) {
            promptTokens = expansionUsage.prompt_tokens ?? null;
            completionTokens = expansionUsage.completion_tokens ?? null;
          }
          await logUsage({
            userId: localUserId,
            endpoint: "/v1/ai/sidebar-chat-streaming",
            model,
            promptTokens,
            completionTokens,
          });
          res.locals.auditDetails = {
            kind: "ai_sidebar_chat_stream",
            provider,
            model,
            messageCount: trimmed.length,
            mode,
            promptTokens,
            completionTokens,
          };
          observeAiGenerationSeconds(
            "sidebar_stream",
            provider,
            Number(process.hrtime.bigint() - genStart) / 1e9,
            true,
          );
          sendSse({ type: "done", finishReason: "stop" });
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const openaiMessages = buildSidebarOpenAIMessages(trimmed, mode);
        const imageJob =
          mode === "topic_plus_images"
            ? runSidebarImagePipeline({
                provider,
                openai,
                model,
                trimmed,
                maxReferenceImages: SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
              })
                .then(({ items, expansionUsage }) => {
                  if (items.length > 0 && !res.writableEnded) {
                    sendSse({ type: "images", images: items });
                  }
                  return { expansionUsage };
                })
                .catch(() => ({ expansionUsage: null }))
            : Promise.resolve({ expansionUsage: null });

        if (provider === "ollama") {
          for await (const delta of ollamaChatStreaming({
            model,
            messages: openaiMessages,
            maxTokens: 2048,
            temperature: 0.7,
          })) {
            if (delta) {
              sendSse({ type: "content", delta });
              emittedContent = true;
            }
          }
          if (!emittedContent) {
            const fallbackText = await ollamaChatNonStreaming({
              model,
              messages: openaiMessages,
              maxTokens: 2048,
              temperature: 0.7,
            });
            if (fallbackText) {
              sendSse({ type: "content", delta: fallbackText });
              emittedContent = true;
            }
          }
        } else {
          const tOpenAi = process.hrtime.bigint();
          const stream = await openai.chat.completions.create({
            model,
            stream: true,
            messages: openaiMessages,
            max_tokens: 2048,
            temperature: 0.7,
            stream_options: { include_usage: true },
          });

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (chunk.usage) {
              promptTokens = (promptTokens ?? 0) + (chunk.usage.prompt_tokens ?? 0);
              completionTokens =
                (completionTokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
            }
            if (delta) {
              sendSse({ type: "content", delta });
              emittedContent = true;
            }
          }
          observeOpenAiSeconds(
            "sidebar_stream",
            Number(process.hrtime.bigint() - tOpenAi) / 1e9,
          );
        }

        const { expansionUsage: imageExpansionUsage } = await imageJob;
        if (imageExpansionUsage) {
          promptTokens = (promptTokens ?? 0) + (imageExpansionUsage.prompt_tokens ?? 0);
          completionTokens =
            (completionTokens ?? 0) + (imageExpansionUsage.completion_tokens ?? 0);
        }

        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/sidebar-chat-streaming",
          model,
          promptTokens,
          completionTokens,
        });
        res.locals.auditDetails = {
          kind: "ai_sidebar_chat_stream",
          provider,
          model,
          messageCount: trimmed.length,
          mode,
          promptTokens,
          completionTokens,
        };
        observeAiGenerationSeconds(
          "sidebar_stream",
          provider,
          Number(process.hrtime.bigint() - genStart) / 1e9,
          true,
        );
        sendSse({ type: "done", finishReason: "stop" });
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (err) {
        observeAiGenerationSeconds(
          "sidebar_stream",
          provider,
          Number(process.hrtime.bigint() - genStart) / 1e9,
          false,
        );
        recordAiGenerationFailure("sidebar_stream", provider);
        res.locals.auditError = err?.message || "sidebar chat stream failed";
        res.locals.auditDetails = {
          kind: "ai_sidebar_chat_stream",
          provider,
          model,
          failed: true,
        };
        sendSse({
          type: "error",
          error: {
            message: publicErrorMessage(err),
            status: err?.status ?? 500,
          },
        });
        res.end();
      }
    },

    async sidebarChat(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);

      const { messages } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.locals.auditError = "sidebar-chat: messages required";
        res.status(400).json({ message: "body.messages must be a non-empty array" });
        return;
      }

      const trimmed = messages
        .slice(-24)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? "").slice(0, 12000),
        }))
        .filter((m) => m.content.length > 0);

      if (!trimmed.length) {
        res.locals.auditError = "sidebar-chat: empty content";
        res.status(400).json({ message: "No valid message content" });
        return;
      }

      const provider = parseAiProvider(req.body);
      if (!requireAiProvider(res, provider)) return;
      const model = parseAiModel(req.body, provider, MODEL);
      const mode = parseSidebarChatMode(req.body);
      const openai = provider === "openai" ? createOpenAIClient() : null;
      const genStart = process.hrtime.bigint();
      try {
        if (mode === "images") {
          const pipelineResult = await runSidebarImagePipeline({
            provider,
            openai,
            model,
            trimmed,
            maxReferenceImages: SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
          });
          const images = pipelineResult.items;
          const promptTokens = pipelineResult.expansionUsage
            ? pipelineResult.expansionUsage.prompt_tokens
            : null;
          const completionTokens = pipelineResult.expansionUsage
            ? pipelineResult.expansionUsage.completion_tokens
            : null;
          await logUsage({
            userId: localUserId,
            endpoint: "/v1/ai/sidebar-chat",
            model,
            promptTokens,
            completionTokens,
          });
          res.locals.auditDetails = {
            kind: "ai_sidebar_chat",
            provider,
            model,
            messageCount: trimmed.length,
            mode,
          };
          observeAiGenerationSeconds(
            "sidebar",
            provider,
            Number(process.hrtime.bigint() - genStart) / 1e9,
            true,
          );
          res.json({ text: "", images, reply: "" });
          return;
        }

        const openaiMessages = buildSidebarOpenAIMessages(trimmed, mode);
        const runPipeline =
          mode === "topic_plus_images"
            ? runSidebarImagePipeline({
                provider,
                openai,
                model,
                trimmed,
                maxReferenceImages: SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
              })
            : Promise.resolve({ items: [], expansionUsage: null });
        const [pipelineResult, completionTextOrObj] = await Promise.all([
          runPipeline,
          provider === "ollama"
            ? ollamaChatNonStreaming({
                model,
                messages: openaiMessages,
                maxTokens: 2048,
                temperature: 0.7,
              })
            : (async () => {
                const t0 = process.hrtime.bigint();
                const r = await openai.chat.completions.create({
                  model,
                  messages: openaiMessages,
                  max_tokens: 2048,
                  temperature: 0.7,
                });
                observeOpenAiSeconds(
                  "sidebar",
                  Number(process.hrtime.bigint() - t0) / 1e9,
                );
                return r;
              })(),
        ]);
        const images = pipelineResult.items;
        let promptTokens = pipelineResult.expansionUsage
          ? pipelineResult.expansionUsage.prompt_tokens
          : null;
        let completionTokens = pipelineResult.expansionUsage
          ? pipelineResult.expansionUsage.completion_tokens
          : null;

        const reply =
          provider === "ollama"
            ? String(completionTextOrObj ?? "").trim()
            : completionTextOrObj.choices[0]?.message?.content?.trim() ?? "";
        const u2 = provider === "openai" ? completionTextOrObj.usage : null;
        if (u2) {
          promptTokens = (promptTokens ?? 0) + (u2.prompt_tokens ?? 0);
          completionTokens = (completionTokens ?? 0) + (u2.completion_tokens ?? 0);
        }

        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/sidebar-chat",
          model,
          promptTokens,
          completionTokens,
        });
        res.locals.auditDetails = {
          kind: "ai_sidebar_chat",
          provider,
          model,
          messageCount: trimmed.length,
          mode,
        };
        observeAiGenerationSeconds(
          "sidebar",
          provider,
          Number(process.hrtime.bigint() - genStart) / 1e9,
          true,
        );
        res.json({ text: reply, images, reply });
      } catch (err) {
        observeAiGenerationSeconds(
          "sidebar",
          provider,
          Number(process.hrtime.bigint() - genStart) / 1e9,
          false,
        );
        recordAiGenerationFailure("sidebar", provider);
        res.locals.auditError = err?.message || "sidebar chat failed";
        res.status(500).json({ message: publicErrorMessage(err) });
      }
    },

    async diagramToCode(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const provider = parseAiProvider(req.body);
      if (!requireAiProvider(res, provider)) return;
      if (provider === "ollama") {
        res.status(400).json({
          message:
            "diagram-to-code image inference currently requires OpenAI vision. Switch provider to OpenAI for this action.",
        });
        return;
      }
      const model = parseAiModel(req.body, provider, VISION_MODEL);
      const localUserId = await upsertUserFromAuth(auth);
      const { texts, image, theme, canvasContext } = req.body ?? {};
      const textBlock = Array.isArray(texts) ? texts.filter(Boolean).join("\n") : "";
      const imageUrl = typeof image === "string" ? image : "";

      let canvasContextBlock = "";
      if (canvasContext != null && typeof canvasContext === "object") {
        try {
          canvasContextBlock =
            "Structured canvas context (use with the image; approximate frame size and shape mix):\n" +
            JSON.stringify(canvasContext, null, 2) +
            "\n\n";
        } catch {
          canvasContextBlock = "";
        }
      }

      if (!imageUrl) {
        res.locals.auditError = "missing image in body";
        res.status(400).json({ message: "image (data URL or URL) is required" });
        return;
      }

      const openai = createOpenAIClient();
      const system =
        "You generate a single self-contained HTML document (only HTML, no markdown) that implements the UI or diagram described. Use inline CSS. Theme hint: " +
        String(theme ?? "light");

      const genStart = process.hrtime.bigint();
      try {
        const tOpenAi = process.hrtime.bigint();
        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    canvasContextBlock +
                    (textBlock
                      ? `Text extracted from shapes inside the frame:\n${textBlock}`
                      : "No separate text was extracted from shapes; rely on the image and canvas context.") +
                    "\n\nTurn this into a single self-contained HTML preview that matches the wireframe.",
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          max_tokens: 4096,
        });
        observeOpenAiSeconds(
          "diagram_to_code",
          Number(process.hrtime.bigint() - tOpenAi) / 1e9,
        );

        let html = completion.choices[0]?.message?.content?.trim() ?? "";
        html = html.replace(/^```html\s*/i, "").replace(/\s*```$/i, "");
        if (!html) {
          observeAiGenerationSeconds(
            "diagram_to_code",
            "openai",
            Number(process.hrtime.bigint() - genStart) / 1e9,
            false,
          );
          recordAiGenerationFailure("diagram_to_code", "openai");
          res.locals.auditError = "Empty model response";
          res.status(500).json({ message: "Empty model response" });
          return;
        }
        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/diagram-to-code/generate",
          model,
          promptTokens: completion.usage?.prompt_tokens ?? null,
          completionTokens: completion.usage?.completion_tokens ?? null,
        });
        res.locals.auditDetails = {
          kind: "ai_diagram_to_code",
          provider,
          model,
          promptTokens: completion.usage?.prompt_tokens ?? null,
          completionTokens: completion.usage?.completion_tokens ?? null,
          theme: theme ?? null,
          textLength: textBlock.length,
          canvasContext: canvasContext != null,
        };
        observeAiGenerationSeconds(
          "diagram_to_code",
          "openai",
          Number(process.hrtime.bigint() - genStart) / 1e9,
          true,
        );
        res.json({ html });
      } catch (err) {
        observeAiGenerationSeconds(
          "diagram_to_code",
          "openai",
          Number(process.hrtime.bigint() - genStart) / 1e9,
          false,
        );
        recordAiGenerationFailure("diagram_to_code", "openai");
        res.locals.auditError = err?.message || "diagram-to-code failed";
        res.locals.auditDetails = {
          kind: "ai_diagram_to_code",
          provider,
          model,
          failed: true,
        };
        res.status(500).json({ message: publicErrorMessage(err) });
      }
    },
  };
}
