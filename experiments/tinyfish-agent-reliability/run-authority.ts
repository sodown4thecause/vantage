/**
 * TinyFish Agent reliability — sub-test B: authoritative advice extraction.
 *
 * Runs the TinyFish agent (lite, strict) against Reddit search for a topic,
 * then asks it to surface expert/authoritative advice from top comments and
 * highly-upvoted answers, and to draft a short reply in a neutral helpful voice
 * grounded in that advice.
 *
 * Run with:
 *   pnpm tinyfish:authority ["topic"]
 *   # or
 *   pnpm tsx experiments/tinyfish-agent-reliability/run-authority.ts ["topic"]
 *
 * Writes runs/<ISO>-authority.json. Standalone and additive.
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
import type { AuthorityVoice, RunRecord, SuggestedReply } from "./types";

const START_URL = "https://www.reddit.com/search/?q=";

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    voices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceUrl: { type: "string" },
          subreddit: { type: "string" },
          threadTitle: { type: "string" },
          author: { type: "string" },
          upvotes: { type: "number" },
          authoritySignal: { type: "string" },
          advice: { type: "string" },
        },
        required: ["sourceUrl", "author", "authoritySignal", "advice"],
      },
    },
    suggestedReply: {
      type: "object",
      properties: {
        text: { type: "string" },
        groundedIn: { type: "array", items: { type: "string" } },
      },
      required: ["text", "groundedIn"],
    },
  },
  required: ["voices", "suggestedReply"],
};

export function buildGoal(topic: string): string {
  return [
    `Find expert or authoritative advice about: "${topic}" inside recent public subreddit conversations.`,
    "Prefer top comments, highly-upvoted answers, and recognised practitioners; capture the comment author and upvote count when visible.",
    "For each voice record: the comment/thread url, subreddit, thread title, author, upvotes (if visible), why it reads as authoritative, and the advice text.",
    "Then write a 2-3 sentence suggested reply in a neutral, helpful voice that is grounded in that advice. Do not invent quotes or numbers.",
    "Return empty arrays if you find nothing usable.",
  ].join("\n");
}

export function normalizeVoices(result: unknown): AuthorityVoice[] {
  const rows = asArrayFrom(result, ["voices", "comments", "results", "items", "data"]);
  const voices: AuthorityVoice[] = [];
  for (const row of rows) {
    const advice = stringField(row, ["advice", "text", "comment", "body", "snippet"]) ?? "";
    if (!advice) continue;
    voices.push({
      sourceUrl: stringField(row, ["sourceUrl", "url", "link", "permalink"]) ?? null,
      subreddit: (stringField(row, ["subreddit", "community"]) ?? "").replace(/^r\//i, "") || null,
      threadTitle: stringField(row, ["threadTitle", "title", "thread_title"]) ?? null,
      author: (stringField(row, ["author", "username", "user"]) ?? "").replace(/^u\//i, "") || null,
      upvotes: numberField(row, ["upvotes", "score", "ups", "votes"]) ?? null,
      authoritySignal:
        stringField(row, ["authoritySignal", "reason", "signal", "why"]) ?? "unspecified",
      advice,
    });
    if (voices.length >= 15) break;
  }
  return voices;
}

export function normalizeReply(result: unknown): SuggestedReply | null {
  const record = asRecord(result);
  const reply = asRecord(record?.suggestedReply ?? record?.reply ?? null);
  if (!reply) return null;
  const text = stringField(reply, ["text", "reply", "body"]) ?? "";
  if (!text) return null;
  const groundedRaw = reply.groundedIn;
  const groundedIn = Array.isArray(groundedRaw)
    ? groundedRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  return { text, groundedIn };
}

async function main(): Promise<void> {
  const { topic, startedAt } = bootstrap();
  const runId = buildRunId(startedAt, "authority");
  const goal = buildGoal(topic);
  const url = `${START_URL}${encodeURIComponent(topic)}`;

  console.log(`[authority] topic="${topic}"`);
  console.log(`[authority] start url: ${url}`);
  console.log(`[authority] agent: browser_profile=lite, mode=strict, max_steps=40`);

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
    const response = await runStructuredAgent(client, { goal, url, outputSchema: OUTPUT_SCHEMA });
    const voices = isCompleted(response) ? normalizeVoices(response.result) : [];
    const reply = isCompleted(response) ? normalizeReply(response.result) : null;
    const steps = sumSteps(response);
    const record: RunRecord = {
      runId,
      startedAt,
      subTest: "authority",
      topic,
      sdkVersion: SDK_VERSION,
      request,
      raw: captureRaw(response),
      response: withCost(
        { ...emptyResponse(), authorityVoices: voices, suggestedReply: reply },
        steps,
      ),
      status: isCompleted(response) ? "ok" : "error",
      error: isCompleted(response)
        ? null
        : redact(response.error?.message ?? `agent status ${response.status}`),
    };
    await writeRun(record);
    printRunSummary(record);
    for (const voice of voices.slice(0, 4)) {
      console.log(`  - u/${voice.author ?? "?"} (${voice.upvotes ?? "?"} up): ${voice.advice.slice(0, 70)}`);
    }
    if (reply) {
      console.log("");
      console.log("  suggested reply:");
      console.log(`    ${reply.text}`);
    }
    if (!isCompleted(response)) process.exitCode = 1;
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    const record: RunRecord = {
      runId,
      startedAt,
      subTest: "authority",
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
    console.error(`[authority] fatal: ${message}`);
    process.exitCode = 1;
  }
}

// ── local parsers ──

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

function numberField(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

main().catch((err) => {
  console.error(`[authority] fatal: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
