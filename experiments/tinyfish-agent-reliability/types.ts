/**
 * Shared types for the TinyFish Agent reliability experiment.
 *
 * A "run" is one sub-test execution (A: subreddit discovery, B: authority
 * extraction, C: YouTube discovery). Each run writes one deterministic JSON
 * file to runs/ so two runs can be diffed for recall variance.
 *
 * This folder is intentionally OUTSIDE the product code path. It must not be
 * imported by app code, schemas, migrations, or tests.
 */

/** Which sub-test produced a run record. */
export type SubTest = "subreddit" | "authority" | "youtube";

/** How a run was executed (an agent run vs. a cheaper search path). */
export type RunMode = "agent_structured" | "search_first" | "agent_plus_search";

/** A subreddit conversation found by the agent (sub-test A). */
export type SubredditThread = {
  /** Reddit thread id when exposed (e.g. "1abc2de"), else a derived slug. */
  id: string;
  /** Subreddit name without the "r/" prefix, when exposed. */
  subreddit: string | null;
  /** Thread title, when exposed. */
  title: string;
  /** Canonical thread url (permalinks preferred). */
  url: string;
  /** Posted date as the agent reported it (ISO when parseable, else raw). */
  postedAt: string | null;
  /** Best-available snippet of the thread body or top comment. */
  snippet: string;
};

/** One authoritative advisor / comment surfaced in sub-test B. */
export type AuthorityVoice = {
  /** Thread or comment url the voice appears in. */
  sourceUrl: string | null;
  /** Subreddit the thread lives in, when exposed. */
  subreddit: string | null;
  /** Thread title the advice appears under, when exposed. */
  threadTitle: string | null;
  /** Author handle without "u/", when exposed. */
  author: string | null;
  /** Upvotes / score on the comment when visible. */
  upvotes: number | null;
  /** Why this voice reads as authoritative (credentials, top comment, etc.). */
  authoritySignal: string;
  /** The advice itself (comment excerpt). */
  advice: string;
};

/** A suggested reply in the user's own voice, grounded in the advice. */
export type SuggestedReply = {
  text: string;
  /** Which authority voices the reply draws on (by author/source url). */
  groundedIn: string[];
};

/** A YouTube video found in sub-test C. */
export type YouTubeVideo = {
  videoId: string | null;
  title: string;
  url: string;
  channel: string | null;
  publishedAt: string | null;
  description: string;
  /** Views / engagement when the agent could read it. */
  viewCount: number | null;
};

/** A YouTube comment thread surfaced in sub-test C. */
export type YouTubeCommentThread = {
  videoId: string | null;
  videoUrl: string;
  author: string | null;
  text: string;
  likeCount: number | null;
  publishedAt: string | null;
};

/** The exact request we sent, minus secrets. Kept for reproducibility. */
export type RunRequest = {
  mode: RunMode;
  /** The TinyFish agent goal string, when an agent ran. */
  goal: string | null;
  /** The starting url the agent was given (usually a search page). */
  url: string | null;
  browserProfile: "lite" | "stealth" | null;
  agentConfig: {
    mode: "default" | "strict" | null;
    maxSteps: number | null;
    maxDurationSeconds: number | null;
  } | null;
  /** The output_schema we asked the agent to fill, when applicable. */
  outputSchema: Record<string, unknown> | null;
  /** Any TinyFish Search queries issued (sub-test C search-first path). */
  searchQueries: string[];
};

/** Raw agent payloads, kept verbatim (redacted) for debugging. */
export type RawCapture = {
  /** TinyFish run status: COMPLETED / FAILED / CANCELLED / ... */
  status: string | null;
  runId: string | null;
  /** The `result` object the agent returned, or a JSON-string wrapper. */
  result: unknown;
  /** The error message on a failed run, else null. */
  error: string | null;
  numOfSteps: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Raw search hits when the search-first path ran. */
  searchHits: Array<{ url: string; title: string; snippet: string; position: number }>;
};

/** Normalized outcome of one sub-test run. */
export type RunResponse = {
  subredditThreads: SubredditThread[];
  authorityVoices: AuthorityVoice[];
  suggestedReply: SuggestedReply | null;
  youtubeVideos: YouTubeVideo[];
  youtubeComments: YouTubeCommentThread[];
  /** Agent steps x $0.016/step (repo price). 0 for pure search/fetch runs. */
  agentSteps: number;
  /** $0.016 per agent step, as priced in lib/costs/prices.ts. */
  estCostUsd: number;
};

/** One sub-test run, as written to runs/<ISO>-<subtest>.json. */
export type RunRecord = {
  runId: string;
  startedAt: string;
  subTest: SubTest;
  topic: string;
  sdkVersion: string;
  request: RunRequest;
  raw: RawCapture;
  response: RunResponse;
  status: "ok" | "error";
  error: string | null;
};

/** The recall diff between two runs of the same sub-test. */
export type RunDiff = {
  subTest: SubTest;
  earlierRunId: string;
  laterRunId: string;
  /** Identities present in the later run but absent earlier. */
  newIds: string[];
  /** Identities present in the earlier run but absent later. */
  goneIds: string[];
  /** Identities present in both runs. */
  retainedIds: string[];
  earlierCount: number;
  laterCount: number;
  /** retained / max(earlier, later); 1 means perfect overlap. */
  overlapRatio: number;
};

/** The repo price for one TinyFish agent step (lib/costs/prices.ts). */
export const TINYFISH_AGENT_STEP_USD = 0.016;
