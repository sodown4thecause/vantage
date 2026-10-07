/**
 * TinyFish Agent reliability — sub-test C: YouTube discovery.
 *
 * Two-step path, cheapest first:
 *   1. TinyFish Search (free per repo pricing) for youtube.com watch pages.
 *   2. A TinyFish structured agent run over YouTube search to collect videos
 *      and comment threads when search alone is thin.
 *
 * Run with:
 *   pnpm tinyfish:youtube ["topic"]
 *   # or
 *   pnpm tsx experiments/tinyfish-agent-reliability/run-youtube.ts ["topic"]
 *
 * Writes runs/<ISO>-youtube.json. Standalone and additive.
 */

import { createClient, captureRaw, redact, runStructuredAgent } from "./lib";
import {
  SDK_VERSION,
  bootstrap,
  buildRunId,
  emptyRequest,
  emptyResponse,
  isCompleted,
  printRunSummary,
  sumSteps,
  withCost,
  writeRun,
} from "./lib";
import type { RawCapture, RunRecord, YouTubeCommentThread, YouTubeVideo } from "./types";

const AGENT_START_URL = "https://www.youtube.com/results?search_query=";

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    videos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          videoId: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          channel: { type: "string" },
          publishedAt: { type: "string" },
          description: { type: "string" },
          viewCount: { type: "number" },
        },
        required: ["title", "url"],
      },
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          videoId: { type: "string" },
          videoUrl: { type: "string" },
          author: { type: "string" },
          text: { type: "string" },
          likeCount: { type: "number" },
          publishedAt: { type: "string" },
        },
        required: ["videoUrl", "author", "text"],
      },
    },
  },
  required: ["videos"],
};

export function buildGoal(topic: string): string {
  return [
    `Find relevant YouTube videos about: "${topic}".`,
    "Open the YouTube search results for that query and collect up to 8 real videos.",
    "For each video return the videoId, title, url, channel, published date, description and view count when visible.",
    "Then open the top 2 videos and collect up to 5 high-engagement top-level comments each (author, text, likes, date).",
    "Do not invent videos or comments. Return empty arrays if you find none.",
  ].join("\n");
}

export function normalizeVideos(result: unknown): YouTubeVideo[] {
  const rows = asArrayFrom(result, ["videos", "results", "items", "data"]);
  const videos: YouTubeVideo[] = [];
  for (const row of rows) {
    const url = stringField(row, ["url", "videoUrl", "link"]) ?? "";
    const title = stringField(row, ["title", "name"]) ?? "";
    if (!url && !title) continue;
    videos.push({
      videoId: stringField(row, ["videoId", "video_id", "id"]) ?? extractVideoId(url),
      title,
      url,
      channel: stringField(row, ["channel", "channelName", "author"]) ?? null,
      publishedAt: stringField(row, ["publishedAt", "published_at", "date", "uploadDate"]) ?? null,
      description: stringField(row, ["description", "snippet", "summary"]) ?? "",
      viewCount: numberField(row, ["viewCount", "view_count", "views"]) ?? null,
    });
    if (videos.length >= 20) break;
  }
  return dedupeVideos(videos);
}

export function normalizeComments(result: unknown): YouTubeCommentThread[] {
  const rows = asArrayFrom(result, ["comments", "commentThreads", "results", "items", "data"]);
  const comments: YouTubeCommentThread[] = [];
  for (const row of rows) {
    const text = stringField(row, ["text", "comment", "body", "content"]) ?? "";
    if (!text) continue;
    const videoUrl = stringField(row, ["videoUrl", "url", "video_url"]) ?? "";
    comments.push({
      videoId: stringField(row, ["videoId", "video_id"]) ?? extractVideoId(videoUrl),
      videoUrl,
      author: (stringField(row, ["author", "user", "username"]) ?? "").replace(/^@/, "") || null,
      text,
      likeCount: numberField(row, ["likeCount", "like_count", "likes", "votes"]) ?? null,
      publishedAt: stringField(row, ["publishedAt", "published_at", "date"]) ?? null,
    });
    if (comments.length >= 40) break;
  }
  return comments;
}

/** Free TinyFish Search for youtube watch pages (repo prices search at $0). */
async function searchYouTube(
  client: ReturnType<typeof createClient>,
  topic: string,
): Promise<{ hits: RawCapture["searchHits"]; videos: YouTubeVideo[] }> {
  try {
    const response = await client.search.query({
      query: `${topic} site:youtube.com`,
      include_domains: "youtube.com,youtu.be",
      purpose: "Find YouTube videos about the topic.",
    });
    const hits = (response.results ?? [])
      .map((r) => ({ url: r.url, title: r.title, snippet: r.snippet, position: r.position }))
      .filter((r) => Boolean(r.url));
    const videos = hits
      .map((hit) => ({
        videoId: extractVideoId(hit.url),
        title: hit.title,
        url: hit.url,
        channel: null,
        publishedAt: null,
        description: hit.snippet,
        viewCount: null,
      }))
      .slice(0, 10);
    return { hits, videos };
  } catch (err) {
    console.warn(`[youtube] search failed: ${redact(err instanceof Error ? err.message : String(err))}`);
    return { hits: [], videos: [] };
  }
}

async function main(): Promise<void> {
  const { topic, startedAt } = bootstrap();
  const runId = buildRunId(startedAt, "youtube");
  const goal = buildGoal(topic);
  const agentUrl = `${AGENT_START_URL}${encodeURIComponent(topic)}`;

  console.log(`[youtube] topic="${topic}"`);
  console.log(`[youtube] searching youtube.com (TinyFish Search, free)...`);

  const client = createClient();
  const request = {
    ...emptyRequest("agent_plus_search"),
    goal,
    url: agentUrl,
    browserProfile: "lite" as const,
    agentConfig: { mode: "strict" as const, maxSteps: 40, maxDurationSeconds: 180 },
    outputSchema: OUTPUT_SCHEMA,
  };

  const { hits, videos: searchVideos } = await searchYouTube(client, topic);
  console.log(`[youtube] search returned ${hits.length} hits`);

  console.log(`[youtube] running structured agent over ${agentUrl}`);
  try {
    const response = await runStructuredAgent(client, { goal, url: agentUrl, outputSchema: OUTPUT_SCHEMA });
    const agentVideos = isCompleted(response) ? normalizeVideos(response.result) : [];
    const comments = isCompleted(response) ? normalizeComments(response.result) : [];
    const videos = dedupeVideos([...agentVideos, ...searchVideos]);
    const steps = sumSteps(response);
    const record: RunRecord = {
      runId,
      startedAt,
      subTest: "youtube",
      topic,
      sdkVersion: SDK_VERSION,
      request: { ...request, searchQueries: [`${topic} site:youtube.com`] },
      raw: captureRaw(response, hits),
      response: withCost(
        { ...emptyResponse(), youtubeVideos: videos, youtubeComments: comments },
        steps,
      ),
      status: isCompleted(response) ? "ok" : "error",
      error: isCompleted(response)
        ? null
        : redact(response.error?.message ?? `agent status ${response.status}`),
    };
    await writeRun(record);
    printRunSummary(record);
    for (const video of videos.slice(0, 5)) {
      console.log(`  - ${video.title.slice(0, 70)}`);
      console.log(`    ${video.url}`);
    }
    if (!isCompleted(response)) process.exitCode = 1;
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    const record: RunRecord = {
      runId,
      startedAt,
      subTest: "youtube",
      topic,
      sdkVersion: SDK_VERSION,
      request: { ...request, searchQueries: [`${topic} site:youtube.com`] },
      raw: { ...captureRaw({
        status: "FAILED",
        run_id: null,
        result: null,
        error: { message, category: "UNKNOWN", retry_after: null },
        num_of_steps: null,
        started_at: null,
        finished_at: null,
      } as never), searchHits: hits },
      response: withCost({ ...emptyResponse(), youtubeVideos: searchVideos }, 0),
      status: "error",
      error: message,
    };
    await writeRun(record);
    console.error(`[youtube] fatal: ${message}`);
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

function extractVideoId(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace(/^\//, "") || null;
    const v = parsed.searchParams.get("v");
    if (v) return v;
    const shorts = parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/);
    return shorts?.[1] ?? null;
  } catch {
    return /^[\w-]{6,}$/.test(url) ? url : null;
  }
}

function dedupeVideos(videos: YouTubeVideo[]): YouTubeVideo[] {
  const byKey = new Map<string, YouTubeVideo>();
  for (const video of videos) {
    const key = video.videoId ?? video.url;
    if (key && !byKey.has(key)) byKey.set(key, video);
  }
  return [...byKey.values()];
}

main().catch((err) => {
  console.error(`[youtube] fatal: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
