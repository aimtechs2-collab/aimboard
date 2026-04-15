/**
 * LLM-assisted expansion into 3–4 image search query strings (JSON).
 * Fallback: template queries from topic seed.
 */

/** Non-LLM fallback for MCP and when OpenAI expansion fails. */
export function templateFallbackQueries(topicSeed) {
  const t = String(topicSeed ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const base = t || "educational teaching diagram";
  const candidates = [
    base,
    `${base} diagram labeled`,
    `${base} educational illustration`,
  ];
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    const s = c.trim().slice(0, 200);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.slice(0, 4);
}

const IMAGE_QUERY_SYSTEM_PROMPT =
  'You help tutors find reference images. Reply with ONLY valid JSON: an object {"queries": string[]} with exactly 3 or 4 short English search strings (each under 180 characters). Queries must work well in Google Images: educational diagrams, labeled figures, illustrations, or concrete visual setups. No markdown, no explanation, no keys other than "queries".';

function buildExpansionContext(trimmed, topicSeed) {
  const users = trimmed.filter((m) => m.role === "user").slice(-2);
  const parts = [];
  for (const u of users) {
    const line = String(u.content ?? "").trim().slice(0, 500);
    if (line) {
      parts.push(line);
    }
  }
  parts.push(
    `Primary topic for image search: ${String(topicSeed).trim().slice(0, 200)}`,
  );
  return parts.join("\n---\n").slice(0, 2000);
}

/**
 * @param {import("openai").OpenAI} openai
 * @param {{ trimmed: Array<{ role: string; content: string }>; topicSeed: string }} opts
 * @param {string} model
 * @returns {Promise<{ queries: string[]; usage: { prompt_tokens: number; completion_tokens: number } | null }>}
 */
export async function expandImageSearchQueriesOpenAI(openai, opts, model) {
  const topicSeed =
    String(opts.topicSeed ?? "").trim() || "teaching reference";
  const context = buildExpansionContext(opts.trimmed, topicSeed);

  try {
    const completion = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 256,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: IMAGE_QUERY_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Conversation context for image search:\n${context}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const queries = parseExpandedQueries(raw);

    const usage = completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens ?? 0,
          completion_tokens: completion.usage.completion_tokens ?? 0,
        }
      : null;

    if (queries.length >= 2) {
      return { queries, usage };
    }
  } catch {
    /* template fallback */
  }

  return {
    queries: templateFallbackQueries(topicSeed),
    usage: null,
  };
}

/**
 * @param {string} baseUrl
 * @param {{ trimmed: Array<{ role: string; content: string }>; topicSeed: string }} opts
 * @param {string} model
 * @returns {Promise<{ queries: string[]; usage: { prompt_tokens: number; completion_tokens: number } | null }>}
 */
export async function expandImageSearchQueriesOllama(baseUrl, opts, model) {
  const topicSeed =
    String(opts.topicSeed ?? "").trim() || "teaching reference";
  const context = buildExpansionContext(opts.trimmed, topicSeed);
  const endpoint = `${String(baseUrl || "").replace(/\/$/, "")}/api/chat`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.3, num_predict: 256 },
        messages: [
          { role: "system", content: IMAGE_QUERY_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Conversation context for image search:\n${context}`,
          },
        ],
      }),
    });
    if (!resp.ok) {
      throw new Error(`Ollama image query expansion failed (${resp.status})`);
    }
    const data = await resp.json();
    const raw = String(data?.message?.content ?? "").trim();
    const queries = parseExpandedQueries(raw);
    if (queries.length >= 2) {
      return { queries, usage: null };
    }
  } catch {
    /* template fallback */
  }

  return {
    queries: templateFallbackQueries(topicSeed),
    usage: null,
  };
}

/**
 * Parse and sanitize model-produced JSON query payload.
 * @param {string} raw
 * @returns {string[]}
 */
function parseExpandedQueries(raw) {
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const seen = new Set();
  const queries = [];
  for (const x of arr) {
    if (typeof x !== "string") {
      continue;
    }
    const s = x.trim().replace(/\s+/g, " ").slice(0, 200);
    if (s && !seen.has(s)) {
      seen.add(s);
      queries.push(s);
    }
    if (queries.length >= 4) {
      break;
    }
  }
  return queries;
}
