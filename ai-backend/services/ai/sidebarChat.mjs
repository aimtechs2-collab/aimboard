import {
  fetchImagesWithMetaFromQueries,
} from "../../lib/googleImageSearch.mjs";
import {
  expandImageSearchQueriesOllama,
  expandImageSearchQueriesOpenAI,
} from "../../lib/imageQueryOpenAI.mjs";

export const SIDEBAR_CHAT_SYSTEM = `You are AimTutor's teaching-planning assistant inside AimTutor.ai, a collaborative whiteboard app.

Your user is a **tutor or teacher** planning what to teach on the whiteboard—not a student who needs a Wikipedia-style explanation.

## Highest-priority rule: subject / unit / course-area messages
If the user names or asks about a **subject, unit, topic area, or course theme**—including very short messages (e.g. "statistics and probability", "linear equations", "photosynthesis")—you must **not** answer with:
- textbook-style **definitions** of the field ("X is the branch of mathematics that…"),
- long introductory paragraphs about what the field *is*,
- generic encouragement ("feel free to ask") **unless** you have **already** delivered the full roadmap below.

**Start the answer immediately** with structured lesson planning. Your **first heading** must be \`## Scope\` (or equivalent)—not a definition block.

### Required structure (use Markdown, be scannable)
1. **## Scope** — At most 1–2 sentences: what you are covering + assumed level if unknown.
2. **## Teachable units** — **Ordered numbered main units** (e.g. 1., 2., 3.). Under **each** unit, **bullets** with **specific subtopics or skills** to teach (outcome-style is good: "Learners can compute conditional probability").
3. **## Suggested sequence** — Prerequisites, what to teach first vs later (short).
4. **## Teaching hooks** (optional, short) — Misconceptions + 1–2 whiteboard ideas.

Aim for **at least 6–10 distinct subtopics** across the units for a broad area like statistics and probability (unless the user asked for a narrow slice). Depth should support **multiple sessions**, not one paragraph.

## When the message is clearly NOT a subject roadmap request
Examples: how to use the app, one specific homework problem, "what does this symbol mean", clarifying a single diagram.

Then answer **directly and concisely** without the full roadmap.

## Style
Pedagogically sound, neutral tone. Do not invent official syllabi or exam boards unless named; state level assumptions once.

## Reference images (automatic)
For **every** user turn, the app uses an internal **OpenAI step** to derive several image search queries from the conversation, runs **web image search**, and shows up to **four** thumbnails in the sidebar (they may appear **while** your reply streams, not only after).

In your reply:
- Assume relevant reference images **will appear** beside the message; tie your explanation to **visual teaching** when it helps (diagrams, setups, examples).
- Do **not** include Markdown images (\`![alt](url)\`), raw image URLs, numbered link lists, or JSON. You may briefly mention what the gallery illustrates (e.g. “see the vector diagrams in the references”).`;

export const SIDEBAR_CHAT_SYSTEM_CHAT = `You are AimTutor's teaching assistant in a sidebar chat beside a collaborative whiteboard.

The user is a **tutor or teacher**. Earlier messages in this thread may contain a structured **roadmap** (Scope, teachable units, sequence, hooks). Your job in this **chat** mode is to **continue that conversation**: clarify units, deepen subtopics, suggest whiteboard activities, address misconceptions, reorder emphasis, answer follow-up questions, or connect to the next lesson.

## Rules
- **Do not** restart from scratch with a full new roadmap unless the user clearly asks for a fresh plan for a **new** subject or unit.
- Use **Markdown** when helpful (short headings, bullets). Be concise unless the user asks for depth.
- This mode does **not** attach automatic reference thumbnails. Do **not** rely on images, and do **not** output Markdown images (\`![alt](url)\`), raw image URLs, or image JSON.
- Stay grounded in what was already said in the thread; ask one clarifying question if needed.`;

export const SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES = 10;
export const SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES = 4;

export function parseSidebarChatMode(body) {
  const raw = typeof body?.mode === "string" ? body.mode.trim() : "";
  if (raw === "images" || raw === "chat" || raw === "topic_plus_images") {
    return raw;
  }
  return "topic_plus_images";
}

export function buildSidebarOpenAIMessages(trimmed, mode) {
  const system = mode === "chat" ? SIDEBAR_CHAT_SYSTEM_CHAT : SIDEBAR_CHAT_SYSTEM;
  return [
    { role: "system", content: system },
    ...trimmed.map((m) => ({ role: m.role, content: m.content })),
  ];
}

function hasSidebarImageSearchCredentials() {
  const hasSerp = Boolean(process.env.SERPAPI_API_KEY?.trim());
  const hasGoogle =
    Boolean(process.env.GOOGLE_API_KEY?.trim()) &&
    Boolean(process.env.GOOGLE_CX?.trim());
  return hasSerp || hasGoogle;
}

function fallbackImageSearchQuery(trimmed) {
  const users = trimmed.filter((m) => m.role === "user");
  const last = String(users[users.length - 1]?.content ?? "").trim();
  const prev =
    users.length >= 2 ? String(users[users.length - 2]?.content ?? "").trim() : "";
  const normalizedLast = last.toLowerCase().replace(/[.!?]+$/g, "").trim();
  const isGenericFollowUp = /^(ok|okay|k|yes|yep|sure|continue|go on|next|more|same|keep going|continue please|more please|again)$/i.test(
    normalizedLast,
  );
  const shortVisualOnly =
    last.length < 56 &&
    /\b(image|images|diagram|picture|pictures|photo|photos|visual)\b/i.test(last);
  if (shortVisualOnly && prev.length > 2) {
    return prev.slice(0, 200);
  }
  if (isGenericFollowUp && prev.length > 10) {
    return prev.slice(0, 200);
  }
  return (last || "teaching reference").slice(0, 200);
}

export async function runSidebarImagePipeline({
  provider,
  openai,
  model,
  trimmed,
  maxReferenceImages = 4,
  ollamaBaseUrl,
  defaultModel,
  logger,
}) {
  if (!hasSidebarImageSearchCredentials()) {
    return { items: [], expansionUsage: null };
  }
  const topicSeed = fallbackImageSearchQuery(trimmed);
  const imageQueryModel =
    model || process.env.OPENAI_IMAGE_QUERY_MODEL?.trim() || defaultModel;
  let expansionResult;
  if (provider === "ollama") {
    expansionResult = await expandImageSearchQueriesOllama(
      ollamaBaseUrl,
      { trimmed, topicSeed },
      imageQueryModel,
    );
  } else {
    expansionResult = await expandImageSearchQueriesOpenAI(
      openai,
      { trimmed, topicSeed },
      imageQueryModel,
    );
  }
  const { queries, usage: expansionUsage } = expansionResult;
  try {
    const { items } = await fetchImagesWithMetaFromQueries(queries, maxReferenceImages);
    return {
      items: Array.isArray(items) ? items : [],
      expansionUsage,
    };
  } catch (err) {
    logger.debug({ err, module: "sidebarChat" }, "sidebar image fetch failed (non-fatal)");
    return { items: [], expansionUsage };
  }
}
