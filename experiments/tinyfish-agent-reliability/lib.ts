/**
 * Shared helpers for the TinyFish Agent reliability experiment.
 *
 * Everything here is standalone: it uses `@tiny-fish/sdk` directly with the
 * same params the repo's `runTinyFishStructuredAgent` uses, but does not import
 * product code. Run records are written to runs/ and never committed.
 */

import { loadEnvFile } from "node:process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BrowserProfile,
  RunStatus,
  TinyFish,
  type AgentRunParams,
  type AgentRunResponse,
} from "@tiny-fish/sdk";

import {
  TINYFISH_AGENT_STEP_USD,
  type RawCapture,
  type RunRecord,
  type RunRequest,
  type RunResponse,
  type SubTest,
} from "./types";

export const THIS_DIR = dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = join(THIS_DIR, "runs");
const LOCAL_ENV_PATH = join(THIS_DIR, ".env.local");
const REPO_ENV_PATH = join(THIS_DIR, "..", "..", ".env.local");

/** SDK version recorded on every run for provenance. */
export const SDK_VERSION = "0.7.0";

/** The intentionally low-signal default topic (match the Grok experiment). */
export const DEFAULT_TOPIC = "free AI GTM signal buzz tool";

/** Agent config mirroring the repo's runTinyFishStructuredAgent defaults. */
export const DEFAULT_AGENT_CONFIG = {
  mode: "strict" as const,
  maxSteps: 40,
  maxDurationSeconds: 180,
};

/** Load .env.local from this experiment dir, then the repo root. Env wins. */
export function loadLocalEnv(): void {
  if (process.env.VANTAGE_TINYFISH_ENV_LOADED) return;
  for (const path of [LOCAL_ENV_PATH, REPO_ENV_PATH]) {
    try {
      loadEnvFile(path);
    } catch {
      // A missing file is fine; requireTinyFishKey() explains what is missing.
    }
  }
  process.env.VANTAGE_TINYFISH_ENV_LOADED = "1";
}

/** The TinyFish key, read from env. Never logged. */
export function requireTinyFishKey(): string {
  const key = process.env.TINY_FISH_API_KEY?.trim() ?? "";
  if (!key) {
    throw new Error(
      "TINY_FISH_API_KEY is not set. Put it in experiments/tinyfish-agent-reliability/.env.local (git-ignored).",
    );
  }
  return key;
}

/** Build the SDK client with an explicit key (the SDK default is no better). */
export function createClient(): TinyFish {
  return new TinyFish({ apiKey: requireTinyFishKey() });
}

/** Redact anything that looks like a secret before logging or persisting. */
export function redact(text: string): string {
  return text
    .replace(/\bsk-tinyfish-[A-Za-z0-9._\-]+/gi, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._\-]+/g, "[REDACTED]")
    .replace(/\bfc-[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/\bvck_[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[REDACTED]");
}

/** Redact secrets recursively inside an unknown JSON value. */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

export type StructuredAgentOptions = {
  goal: string;
  url: string;
  outputSchema: Record<string, unknown>;
  browserProfile?: "lite" | "stealth";
  maxSteps?: number;
  maxDurationSeconds?: number;
};

/**
 * Run the TinyFish agent with the repo's exact params shape (lite, strict mode).
 * Returns the raw SDK response; callers normalize it. Never throws on a FAILED
 * run — the caller records status and error (failed runs cost no steps).
 */
export async function runStructuredAgent(
  client: TinyFish,
  opts: StructuredAgentOptions,
): Promise<AgentRunResponse> {
  const params: AgentRunParams = {
    url: opts.url,
    goal: opts.goal,
    browser_profile: opts.browserProfile ?? BrowserProfile.LITE,
    output_schema: opts.outputSchema,
    agent_config: {
      mode: DEFAULT_AGENT_CONFIG.mode,
      max_steps: opts.maxSteps ?? DEFAULT_AGENT_CONFIG.maxSteps,
      max_duration_seconds:
        opts.maxDurationSeconds ?? DEFAULT_AGENT_CONFIG.maxDurationSeconds,
    },
  };
  return client.agent.run(params);
}

/** Capture the SDK response into a raw, secret-free shape. */
export function captureRaw(
  response: AgentRunResponse,
  searchHits: RawCapture["searchHits"] = [],
): RawCapture {
  return {
    status: response.status ?? null,
    runId: response.run_id ?? null,
    result: redactDeep(response.result ?? null),
    error: response.error?.message ? redact(response.error.message) : null,
    numOfSteps: response.num_of_steps ?? null,
    startedAt: response.started_at ?? null,
    finishedAt: response.finished_at ?? null,
    searchHits,
  };
}

/** True when the SDK run reached COMPLETED with no error. */
export function isCompleted(response: AgentRunResponse): boolean {
  return response.status === RunStatus.COMPLETED && !response.error;
}

/** Total agent steps across responses, for cost estimation. */
export function sumSteps(...responses: AgentRunResponse[]): number {
  return responses.reduce((total, r) => total + Math.max(0, r.num_of_steps ?? 0), 0);
}

export function emptyResponse(): RunResponse {
  return {
    subredditThreads: [],
    authorityVoices: [],
    suggestedReply: null,
    youtubeVideos: [],
    youtubeComments: [],
    agentSteps: 0,
    estCostUsd: 0,
  };
}

/** Attach step count + estimated cost (steps x $0.016/step). */
export function withCost(response: RunResponse, agentSteps: number): RunResponse {
  return {
    ...response,
    agentSteps,
    estCostUsd: Number((agentSteps * TINYFISH_AGENT_STEP_USD).toFixed(6)),
  };
}

export function buildRunId(startedAt: string, subTest: SubTest): string {
  return `${startedAt.replace(/[:.]/g, "-")}-${subTest}`;
}

export async function writeRun(record: RunRecord): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${record.runId}.json`);
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

export async function listRunFiles(subTest?: SubTest): Promise<string[]> {
  const entries = await readdir(RUNS_DIR).catch(() => []);
  return entries
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !subTest || name.includes(`-${subTest}.json`))
    .sort()
    .map((name) => join(RUNS_DIR, name));
}

export async function readRun(path: string): Promise<RunRecord> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as RunRecord;
}

/** Print a short human summary of a completed sub-test run. */
export function printRunSummary(record: RunRecord): void {
  const r = record.response;
  console.log("");
  console.log("── TinyFish agent run summary ────────────────");
  console.log(`sub-test     : ${record.subTest}`);
  console.log(`topic        : ${record.topic}`);
  console.log(`status       : ${record.status}`);
  console.log(`agent steps  : ${r.agentSteps}`);
  console.log(`est. cost    : $${r.estCostUsd.toFixed(6)} ($${TINYFISH_AGENT_STEP_USD}/step)`);
  if (record.subTest === "subreddit") {
    const subs = new Set(r.subredditThreads.map((t) => t.subreddit).filter(Boolean));
    console.log(`threads      : ${r.subredditThreads.length}`);
    console.log(`subreddits   : ${subs.size}`);
  }
  if (record.subTest === "authority") {
    console.log(`voices       : ${r.authorityVoices.length}`);
    console.log(`reply        : ${r.suggestedReply ? "yes" : "no"}`);
  }
  if (record.subTest === "youtube") {
    console.log(`videos       : ${r.youtubeVideos.length}`);
    console.log(`comment rows : ${r.youtubeComments.length}`);
  }
  console.log(`run file     : experiments/tinyfish-agent-reliability/runs/${record.runId}.json`);
  console.log("──────────────────────────────────────────────");
}

/** Shared CLI bootstrap: load env, parse topic. */
export function bootstrap(): { topic: string; startedAt: string } {
  loadLocalEnv();
  const topic = process.argv[2]?.trim() || DEFAULT_TOPIC;
  return { topic, startedAt: new Date().toISOString() };
}

export function emptyRequest(mode: RunRequest["mode"]): RunRequest {
  return {
    mode,
    goal: null,
    url: null,
    browserProfile: null,
    agentConfig: null,
    outputSchema: null,
    searchQueries: [],
  };
}
