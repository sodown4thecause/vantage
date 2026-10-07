/**
 * Grok X reliability experiment — one scan.
 *
 * Calls xAI's `grok-4.7` through the Vercel AI Gateway (OpenAI-compatible
 * Responses API) with the server-side `x_search` tool, asks for X/Twitter
 * conversation about a topic, and writes a deterministic JSON run record.
 *
 * Run with:  pnpm tsx experiments/grok-x-reliability/run-scan.ts ["topic"]
 *
 * This script is standalone and additive. It does not touch product code.
 */

import "dotenv/config";
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GROK_4_7_PRICING,
  type CitedPost,
  type CostEstimate,
  type ModelPricing,
  type RunEndpoint,
  type RunRecord,
  type RunRequest,
  type RunResponse,
  type RunUsage,
} from "./types";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(THIS_DIR, "runs");
const LOCAL_ENV_PATH = join(THIS_DIR, ".env.local");

/**
 * Load the experiment-local `.env.local` (git-ignored) so `pnpm grok:scan`
 * works without exporting vars. Real process env always wins, so CI or an
 * explicit `$env:AI_GATEWAY_API_KEY` still overrides the file.
 */
function loadLocalEnv(): void {
  if (process.env.VANTAGE_GROK_ENV_LOADED) return;
  try {
    loadEnvFile(LOCAL_ENV_PATH);
  } catch {
    // No local file is fine; requireEnv() explains what is missing later.
  }
  process.env.VANTAGE_GROK_ENV_LOADED = "1";
}

/** The intentionally low-signal default topic for this experiment. */
const DEFAULT_TOPIC = "free AI GTM signal buzz tool";

/** Days of history to request when the API supports a from-date filter. */
const LOOKBACK_DAYS = 7;

const DEFAULT_GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_XAI_BASE = "https://api.x.ai/v1";

/**
 * Model ids to try, in order. The gateway lists grok-4.7 under the
 * `spacexai/` namespace, so that is tried first; the others are fallbacks.
 */
const GATEWAY_MODEL_CANDIDATES = [
  "spacexai/grok-4.7",
  "xai/grok-4.7",
  "grok-4.7",
];

type HttpAttempt = {
  endpoint: RunEndpoint;
  baseUrl: string;
  model: string;
  url: string;
  body: unknown;
  status: number;
  ok: boolean;
  raw: unknown;
  rawText: string;
};

/** Redact anything that looks like a secret before logging or persisting. */
function redact(text: string): string {
  return text
    .replace(/\bvck_[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._\-]+/g, "[REDACTED]")
    .replace(/\bfc-[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[REDACTED]")
    .replace(/(xai-[A-Za-z0-9._\-]{4})[A-Za-z0-9._\-]+/gi, "$1[REDACTED]");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Put it in experiments/grok-x-reliability/.env.local or the repo .env.`,
    );
  }
  return value;
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Build the Responses API request body with the server-side x_search tool. */
function buildRequestBody(params: {
  model: string;
  topic: string;
  fromDate: string;
}): unknown {
  return {
    model: params.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Search X/Twitter for conversations about: "${params.topic}". ` +
              `Find real posts from the last ${LOOKBACK_DAYS} days. Return a short summary, ` +
              `then a list of the posts you found. For each post give the author handle, the ` +
              `post text, the url, and the posted date if you can see it.`,
          },
        ],
      },
    ],
    tools: [
      {
        type: "x_search",
        x_search: {
          from_date: params.fromDate,
        },
      },
    ],
  };
}

async function postJson(
  endpoint: RunEndpoint,
  baseUrl: string,
  apiKey: string,
  body: unknown,
): Promise<HttpAttempt> {
  const url = `${baseUrl.replace(/\/$/, "")}/responses`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = redact(await response.text());
  let raw: unknown = rawText;
  try {
    raw = JSON.parse(rawText);
  } catch {
    // Keep the raw text when the provider returns a non-JSON error page.
  }
  return {
    endpoint,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model: (body as { model?: string }).model ?? "unknown",
    url,
    body,
    status: response.status,
    ok: response.ok,
    raw,
    rawText,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberField(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Concatenate all text segments from a Responses API `output` array. */
function extractOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = payload.output;
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (!record) continue;
    const content = record.content;
    if (!Array.isArray(content)) continue;
    for (const segment of content) {
      const seg = asRecord(segment);
      if (seg && typeof seg.text === "string" && seg.text.trim()) {
        parts.push(seg.text.trim());
      }
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

function derivePostId(url: string | null, author: string | null, text: string): string {
  if (url) {
    const match = url.match(/status\/(\d+)/);
    if (match) return match[1];
    return url;
  }
  const slug = `${author ?? "unknown"}:${text}`.slice(0, 120);
  return slug;
}

function toPost(raw: Record<string, unknown>): CitedPost | null {
  const url =
    stringField(raw, ["url", "link", "permalink", "post_url", "tweet_url"]) ?? null;
  const author = stringField(raw, [
    "author",
    "username",
    "handle",
    "screen_name",
    "user",
  ]);
  const text =
    stringField(raw, ["text", "content", "snippet", "body", "post_text"]) ?? "";
  if (!url && !text) return null;
  const postedAt =
    stringField(raw, ["posted_at", "created_at", "createdAt", "date", "timestamp"]) ??
    null;
  return {
    id: derivePostId(url, author, text),
    url,
    author: author?.replace(/^@/, "") ?? null,
    text,
    postedAt,
  };
}

/** Pull structured posts out of any `annotations`, `citations`, or `posts` arrays. */
function extractPosts(payload: Record<string, unknown>): {
  posts: CitedPost[];
  citations: unknown[];
} {
  const posts: CitedPost[] = [];
  const citations: unknown[] = [];

  const collectFromArray = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      citations.push(entry);
      const record = asRecord(entry);
      if (!record) continue;
      const nested = asRecord(record.url_citation) ?? record;
      const post = toPost(nested);
      if (post) posts.push(post);
    }
  };

  const output = payload.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const record = asRecord(item);
      if (!record) continue;
      collectFromArray(record.annotations);
      collectFromArray(record.citations);
      collectFromArray(record.posts);
      const content = record.content;
      if (Array.isArray(content)) {
        for (const segment of content) {
          const seg = asRecord(segment);
          if (!seg) continue;
          collectFromArray(seg.annotations);
          collectFromArray(seg.citations);
        }
      }
    }
  }
  collectFromArray(payload.citations);
  collectFromArray(payload.posts);

  return { posts: dedupePosts(posts), citations };
}

function dedupePosts(posts: CitedPost[]): CitedPost[] {
  const byKey = new Map<string, CitedPost>();
  for (const post of posts) {
    const key = post.url ?? post.id;
    if (!byKey.has(key)) byKey.set(key, post);
  }
  return [...byKey.values()];
}

const POST_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/g;

/** Convert the model's "Tue, 06 Oct 2026" date to ISO 8601 (UTC), or null. */
function toIsoDate(humanDate: string | null): string | null {
  if (!humanDate) return null;
  const parsed = new Date(humanDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The model returns posts as markdown blocks, not structured citations:
 *
 *   - **@handle** — Tue, 06 Oct 2026
 *     <post body across several lines>
 *     https://x.com/handle/status/123
 *
 * Parse those blocks so each post keeps its body text and posted date, then
 * fall back to bare URLs for any post written without the block shape.
 */
function extractPostsFromText(text: string | null): CitedPost[] {
  if (!text) return [];

  const blocks = text.split(/\n(?=-\s+\*\*@)/);
  const posts: CitedPost[] = [];
  for (const block of blocks) {
    const url = block.match(POST_URL_PATTERN)?.[0];
    if (!url) continue;
    const author = block.match(/\*\*@([A-Za-z0-9_]{1,15})\*\*/)?.[1] ?? null;
    const postedAt = toIsoDate(
      block.match(/—\s*([A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/)?.[1] ?? null,
    );
    const body = block
      .replace(/^\s*-\s+\*\*@[A-Za-z0-9_]{1,15}\*\*\s*—[^\n]*\n?/, "")
      .replace(/\s*https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+\s*$/m, "")
      .replace(/\s+/g, " ")
      .trim();
    posts.push({
      id: derivePostId(url, author, body),
      url,
      author,
      text: body,
      postedAt,
    });
  }

  const covered = new Set(posts.map((post) => post.url));
  const bareUrls = (text.match(POST_URL_PATTERN) ?? []).filter((url) => !covered.has(url));
  for (const url of bareUrls) {
    const handle = url.match(/\.com\/([A-Za-z0-9_]{1,15})\/status/)?.[1] ?? null;
    posts.push({
      id: derivePostId(url, handle, ""),
      url,
      author: handle,
      text: "",
      postedAt: null,
    });
  }

  return dedupePosts(posts);
}

function extractUsage(payload: Record<string, unknown>): RunUsage {
  const usage = asRecord(payload.usage);
  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      totalTokens: null,
      raw: null,
    };
  }
  const inputDetails = asRecord(usage.input_tokens_details);
  const promptDetails = asRecord(usage.prompt_tokens_details);
  return {
    inputTokens: numberField(usage, ["input_tokens", "prompt_tokens"]),
    outputTokens: numberField(usage, ["output_tokens", "completion_tokens"]),
    cachedInputTokens:
      numberField(usage, ["cached_input_tokens", "cache_read_input_tokens"]) ??
      numberField(inputDetails ?? {}, ["cached_tokens"]) ??
      numberField(promptDetails ?? {}, ["cached_tokens"]),
    totalTokens: numberField(usage, ["total_tokens"]),
    raw: usage,
  };
}

/** Provider-reported cost, when the gateway/xAI returns one directly. */
function extractReportedCost(payload: Record<string, unknown>): number | null {
  const usage = asRecord(payload.usage);
  const candidates = [
    payload.cost,
    payload.cost_usd,
    usage?.cost,
    usage?.cost_usd,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Tiered price per 1M tokens: long-context pricing once tokens exceed the threshold. */
function pricePerMillion(
  tokens: number,
  standardPrice: number,
  longContextPrice: number,
  threshold: number,
): number {
  return tokens > threshold ? longContextPrice : standardPrice;
}

/**
 * Estimate cost from usage tokens and published pricing. Returns a null USD
 * value when no token counts were available.
 */
function estimateCost(usage: RunUsage): CostEstimate {
  const pricing: ModelPricing = GROK_4_7_PRICING;
  if (usage.inputTokens === null && usage.outputTokens === null) {
    return { usd: null, longContext: false, pricing };
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;

  const inputUsd =
    (inputTokens / 1_000_000) *
    pricePerMillion(
      inputTokens,
      pricing.inputPerMillion,
      pricing.inputPerMillionLongContext,
      pricing.longContextThreshold,
    );
  const outputUsd =
    (outputTokens / 1_000_000) *
    pricePerMillion(
      outputTokens,
      pricing.outputPerMillion,
      pricing.outputPerMillionLongContext,
      pricing.longContextThreshold,
    );
  const cachedUsd =
    (cachedInputTokens / 1_000_000) *
    pricePerMillion(
      cachedInputTokens,
      pricing.cachedInputReadPerMillion,
      pricing.cachedInputReadPerMillionLongContext,
      pricing.longContextThreshold,
    );

  return {
    usd: inputUsd + outputUsd + cachedUsd,
    longContext:
      inputTokens > pricing.longContextThreshold ||
      outputTokens > pricing.longContextThreshold,
    pricing,
  };
}

/** Prefer a provider-reported cost; fall back to our token-based estimate. */
function resolveCost(payload: Record<string, unknown>, usage: RunUsage): {
  costUsd: number | null;
  cost: CostEstimate;
} {
  const estimate = estimateCost(usage);
  const reported = extractReportedCost(payload);
  if (reported !== null) {
    return { costUsd: reported, cost: { ...estimate, usd: reported } };
  }
  return { costUsd: estimate.usd, cost: estimate };
}

function summarize(text: string | null, posts: CitedPost[]): string | null {
  if (text) return text;
  if (posts.length) return null;
  return null;
}

function printSummary(record: RunRecord): void {
  const posts = record.response.posts;
  const authors = new Set(posts.map((p) => p.author).filter(Boolean));
  const threads = new Set(posts.map((p) => p.url).filter(Boolean));
  console.log("");
  console.log("── Scan summary ─────────────────────────────");
  console.log(`topic        : ${record.topic}`);
  console.log(`model        : ${record.model} (${record.endpoint})`);
  console.log(`status       : ${record.status}`);
  console.log(`posts found  : ${posts.length}`);
  console.log(`unique authors: ${authors.size}`);
  console.log(`distinct threads: ${threads.size}`);
  const costText =
    record.response.costUsd === null
      ? "unknown (no usage tokens)"
      : `$${record.response.costUsd.toFixed(6)}${record.response.cost.longContext ? " (long-context)" : ""}`;
  console.log(`est. cost    : ${costText}`);
  console.log(`run file     : experiments/grok-x-reliability/runs/${record.runId}.json`);
  if (posts.length) {
    console.log("");
    console.log("sample posts:");
    for (const post of posts.slice(0, 5)) {
      const who = post.author ? `@${post.author}` : "(unknown author)";
      const snippet = post.text ? post.text.slice(0, 80) : "(no snippet)";
      console.log(`  - ${who}: ${snippet}`);
      console.log(`    ${post.url ?? "(no url)"}`);
    }
  }
  console.log("─────────────────────────────────────────────");
}

async function writeRun(record: RunRecord): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${record.runId}.json`);
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

async function main(): Promise<void> {
  loadLocalEnv();
  const topic = process.argv[2]?.trim() || DEFAULT_TOPIC;
  const fromDate = isoDaysAgo(LOOKBACK_DAYS);
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, "-");

  const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim() ?? "";
  const xaiKey = process.env.XAI_API_KEY?.trim() ?? "";

  console.log(`[scan] topic="${topic}" from=${fromDate}`);
  console.log(`[scan] AI_GATEWAY_API_KEY=${gatewayKey ? "set" : "unset"}, XAI_API_KEY=${xaiKey ? "set" : "unset"}`);

  const gatewayBase = (process.env.AI_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE).replace(/\/$/, "");
  const xaiBase = (process.env.XAI_BASE_URL ?? DEFAULT_XAI_BASE).replace(/\/$/, "");

  let lastError: { endpoint: RunEndpoint; model: string; url: string; status: number; body: string } | null =
    null;

  // 1) Prefer the Vercel AI Gateway, trying each documented model id.
  if (gatewayKey) {
    for (const model of GATEWAY_MODEL_CANDIDATES) {
      const body = buildRequestBody({ model, topic, fromDate });
      console.log(`[scan] trying gateway model "${model}" -> ${gatewayBase}/responses`);
      const attempt = await postJson("ai-gateway", gatewayBase, gatewayKey, body);
      if (attempt.ok) {
        await finishRun({ attempt, topic, fromDate, runId, startedAt });
        return;
      }
      console.error(`[scan] gateway model "${model}" failed (HTTP ${attempt.status})`);
      console.error(redact(typeof attempt.rawText === "string" ? attempt.rawText.slice(0, 2000) : ""));
      lastError = {
        endpoint: "ai-gateway",
        model,
        url: attempt.url,
        status: attempt.status,
        body: attempt.rawText.slice(0, 4000),
      };
    }
  } else {
    console.warn("[scan] AI_GATEWAY_API_KEY unset; skipping gateway.");
  }

  // 2) Fall back to xAI direct only when the gateway is unavailable.
  if (xaiKey) {
    const model = "grok-4.7";
    const body = buildRequestBody({ model, topic, fromDate });
    console.log(`[scan] trying xAI direct model "${model}" -> ${xaiBase}/responses`);
    const attempt = await postJson("xai-direct", xaiBase, xaiKey, body);
    if (attempt.ok) {
      await finishRun({ attempt, topic, fromDate, runId, startedAt });
      return;
    }
    console.error(`[scan] xAI direct failed (HTTP ${attempt.status})`);
    console.error(redact(typeof attempt.rawText === "string" ? attempt.rawText.slice(0, 2000) : ""));
    lastError = {
      endpoint: "xai-direct",
      model,
      url: attempt.url,
      status: attempt.status,
      body: attempt.rawText.slice(0, 4000),
    };
  }

  if (!gatewayKey && !xaiKey) {
    throw new Error(
      "No API key available. Set AI_GATEWAY_API_KEY (preferred) or XAI_API_KEY.",
    );
  }

  const message = lastError
    ? `All model endpoints failed. Last error: HTTP ${lastError.status} from ${lastError.url} (${lastError.model}).`
    : "All model endpoints failed for an unknown reason.";
  const record: RunRecord = {
    runId,
    startedAt,
    topic,
    model: lastError?.model ?? "unknown",
    endpoint: lastError?.endpoint ?? "ai-gateway",
    request: {
      endpoint: lastError?.url ?? gatewayBase,
      model: lastError?.model ?? "unknown",
      topic,
      fromDate,
      body: null,
    },
    response: {
      text: null,
      citations: [],
      posts: [],
      usage: {
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        totalTokens: null,
        raw: null,
      },
      costUsd: null,
      cost: { usd: null, longContext: false, pricing: GROK_4_7_PRICING },
    },
    status: "error",
    error: message,
  };
  await writeRun(record);
  console.error(`[scan] FAILED: ${message}`);
  if (lastError) console.error(`[scan] error body:\n${lastError.body}`);
  process.exitCode = 1;
}

async function finishRun(params: {
  attempt: HttpAttempt;
  topic: string;
  fromDate: string;
  runId: string;
  startedAt: string;
}): Promise<void> {
  const { attempt, topic, fromDate, runId, startedAt } = params;
  const payload = asRecord(attempt.raw) ?? {};
  const text = extractOutputText(payload);
  const { posts: structuredPosts, citations } = extractPosts(payload);
  const textPosts = extractPostsFromText(text);
  const posts = dedupePosts([...structuredPosts, ...textPosts]);
  const usage = extractUsage(payload);
  const { costUsd, cost } = resolveCost(payload, usage);

  const response: RunResponse = {
    text: summarize(text, posts),
    citations,
    posts,
    usage,
    costUsd,
    cost,
  };

  const request: RunRequest = {
    endpoint: attempt.endpoint,
    model: attempt.model,
    topic,
    fromDate,
    body: attempt.body,
  };

  const record: RunRecord = {
    runId,
    startedAt,
    topic,
    model: attempt.model,
    endpoint: attempt.endpoint,
    request,
    response,
    status: "ok",
    error: null,
  };
  await writeRun(record);
  console.log(`[scan] success via ${attempt.endpoint} (${attempt.model}) HTTP ${attempt.status}`);
  printSummary(record);
}

main().catch((err) => {
  console.error(`[scan] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
