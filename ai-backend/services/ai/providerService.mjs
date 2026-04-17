import OpenAI from "openai";

export function createAiProviderService({
  isProduction,
  aiProviderDefault,
  ollamaBaseUrl,
  ollamaModel,
  ollamaTimeoutMs,
}) {
  function parseAiProvider(body) {
    const raw = typeof body?.provider === "string" ? body.provider.trim() : "";
    if (raw === "ollama" || raw === "gpu") {
      return "ollama";
    }
    if (raw === "openai") {
      return "openai";
    }
    return aiProviderDefault;
  }

  function parseAiModel(body, provider, fallback) {
    const fromBody =
      typeof body?.model === "string" ? body.model.trim().slice(0, 120) : "";
    if (fromBody) return fromBody;
    if (provider === "ollama") return ollamaModel;
    return fallback;
  }

  function requireAiProvider(res, provider) {
    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        res.locals.auditError = "OPENAI_API_KEY is not set";
        res.status(500).json({
          message: isProduction
            ? "Server configuration error"
            : "OPENAI_API_KEY is not set. Add it to .env.development.local in the repo root.",
        });
        return false;
      }
      return true;
    }
    if (!ollamaBaseUrl) {
      res.locals.auditError = "OLLAMA_BASE_URL is not set";
      res.status(500).json({
        message: isProduction
          ? "Server configuration error"
          : "OLLAMA_BASE_URL is not set. Add it to .env.development.local in the repo root.",
      });
      return false;
    }
    return true;
  }

  function createOpenAIClient() {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async function ollamaChatNonStreaming({
    model,
    messages,
    temperature = 0.7,
    maxTokens = 2048,
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ollamaTimeoutMs);
    try {
      const resp = await fetch(`${ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature, num_predict: maxTokens },
          messages,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Ollama error ${resp.status}: ${body || resp.statusText}`);
      }
      const data = await resp.json();
      return String(data?.message?.content ?? data?.response ?? "");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function* ollamaChatStreaming({
    model,
    messages,
    temperature = 0.7,
    maxTokens = 2048,
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ollamaTimeoutMs);
    try {
      const resp = await fetch(`${ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: true,
          options: { temperature, num_predict: maxTokens },
          messages,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Ollama error ${resp.status}: ${body || resp.statusText}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error("No Ollama response stream");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }
          const delta = String(parsed?.message?.content ?? parsed?.response ?? "");
          if (delta) {
            yield delta;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    parseAiProvider,
    parseAiModel,
    requireAiProvider,
    createOpenAIClient,
    ollamaChatNonStreaming,
    ollamaChatStreaming,
  };
}
