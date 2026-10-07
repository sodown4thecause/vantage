/**
 * TinyFish Agent reliability — sub-test A: subreddit conversation discovery.
 *
 * Runs the TinyFish agent (browser profile "lite", strict mode) against Reddit
 * search with a structured output_schema, asking it to find recent subreddit
 * conversations about a topic and return subreddit name, thread title, url,
 * posted date, and a snippet.
 *
 * Run with:
 *   pnpm tinyfish:reddit ["topic"]
 *   # or
 *   pnpm tsx experiments/tinyfish-agent-reliability/run-subreddit.ts ["topic"]
 *
 * Writes runs/<ISO>-subreddit.json. Standalone and additive.
 */

import {
  captureRaw,
  createClient,
  emptyRequest,
  emptyResponse,
  isCompleted,
  printRunSummary,
  redact,
  runStructuredAgent,
  SDK_VERSION,
  sumSteps,
  withCost,
  writeRun,
  bootstrap,
  buildRunId,
} from "./lib";
import type { RunRecord, SubredditThread } from "./types";

/** Reddit search url the agent starts from. */
const START_URL = "https://www.reddit.com/search/?q=";

/** Structured output the agent must fill. Mirrors the repo's schema style. */
const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          subreddit: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          postedAt: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["subreddit", "title", "url"],
      },
    },
  },
  required: ["threads"],
};

/** Compose the goal given the topic. Kept explicit so runs are comparable. */
export function buildGoal(topic: string): string {
  return [
    `Find recent public subreddit conversations about: "${topic}".`,
    "Start on the Reddit search page for that query.",
    "Collect up to 10 real threads from the last 30 days, across different subreddits.",
    "For each thread return the subreddit name, the thread title, the full url, the posted date, and a short snippet of the thread or its top comment.",
    "Do not invent threads. Return an empty array if you find none.",
  ].join("\n");
}

/** Parse an unknown agent result into normalized subreddit threads. */
export function normalizeThreads(result: unknown): SubredditThread[] {
  const rows = asArrayFrom(result, ["threads", "results", "items", "data"]);
  const threads: SubredditThread[] = [];
  for (const row of rows) {
    const url = stringField(row, ["url", "link", "permalink", "full_link"]);
    const title = stringField(row, ["title", "name"]) ?? "";
    if (!url && !title) continue;
    const rawSub = stringField(row, ["subreddit", "subreddit_name", "community"]);
    const subreddit = rawSub ? rawSub.replace(/^r\//i, "") : subredditFromUrl(url);
    threads.push({
      id: stringField(row, ["id", "thread_id"]) ?? idFromUrl(url) ?? `thread-${threads.length + 1}`,
      subreddit: subreddit ?? null,
      title,
      url: url ?? "",
      postedAt: toIsoOrRaw(
        stringField(row, ["postedAt", "posted_at", "created_at", "createdAt", "date"]),
      ),
      snippet: stringField(row, ["snippet", "body", "selftext", "text", "excerpt"]) ?? "",
    });
    if (threads.length >= 25) break;
  }
  return dedupeThreads(threads);
}

function dedupeThreads(threads: SubredditThread[]): SubredditThread[] {
  const byKey = new Map<string, SubredditThread>();
  for (const thread of threads) {
    const key = thread.url || thread.id;
    if (!byKey.has(key)) byKey.set(key, thread);
  }
  return [...byKey.values()];
}

async function main(): Promise<void> {
  const { topic, startedAt } = bootstrap();
  const runId = buildRunId(startedAt, "subreddit");
  const goal = buildGoal(topic);
  const url = `${START_URL}${encodeURIComponent(topic)}`;

  console.log(`[subreddit] topic="${topic}"`);
  console.log(`[subreddit] start url: ${url}`);
  console.log(`[subreddit] agent: browser_profile=lite, mode=strict, max_steps=40`);

  const client = createClient();
  const request = {
    ...emptyRequest("agent_structured"),
    goal,
    url,
    browserProfile: "lite" as const,
    agentConfig: { mode: "strict" as const, maxSteps: 40, maxDurationSeconds: 180 },
    outputSchema: OUTPUT_SCHEMA,
  };

  try {
    const response = await runStructuredAgent(client, {
      goal,
      url,
      outputSchema: OUTPUT_SCHEMA,
    });
    const threads = isCompleted(response) ? normalizeThreads(response.result) : [];
    const steps = sumSteps(response);
    const record: RunRecord = {
      runId,
      startedAt,
      subTest: "subreddit",
      topic,
      sdkVersion: SDK_VERSION,
      request,
      raw: captureRaw(response),
      response: withCost({ ...emptyResponse(), subredditThreads: threads }, steps),
      status: isCompleted(response) ? "ok" : "error",
      error: isCompleted(response)
        ? null
        : redact(response.error?.message ?? `agent status ${response.status}`),
    };
    await writeRun(record);
    printRunSummary(record);
    for (const thread of threads.slice(0, 5)) {
      console.log(`  - r/${thread.subreddit ?? "?"}: ${thread.title.slice(0, 70)}`);
      console.log(`    ${thread.url}`);
    }
    if (!isCompleted(response)) process.exitCode = 1;
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    const record: RunRecord = {
      runId,
      startedAt,
      subTest: "subreddit",
      topic,
      sdkVersion: SDK_VERSION,
      request,
      raw: captureRaw({
        status: "FAILED",
        run_id: null,
        result: null,
        error: { message, category: "UNKNOWN", retry_after: null },
        num_of_steps: null,
        started_at: null,
        finished_at: null,
      } as never),
      response: emptyResponse(),
      status: "error",
      error: message,
    };
    await writeRun(record);
    console.error(`[subreddit] fatal: ${message}`);
    process.exitCode = 1;
  }
}

// ── small parsers (kept local; the experiment must not import product code) ──

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArrayFrom(value: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => asRecord(v) !== null);
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return asArrayFrom(record[key], keys);
  }
  return [];
}

function stringField(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function subredditFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/reddit\.com\/r\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function idFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/comments\/([a-z0-9]+)/i);
  return match?.[1] ?? null;
}

function toIsoOrRaw(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

main().catch((err) => {
  console.error(`[subreddit] fatal: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
