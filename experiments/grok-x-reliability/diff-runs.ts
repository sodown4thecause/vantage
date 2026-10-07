/**
 * Grok X reliability experiment — diff two runs.
 *
 * Compares the two most recent run JSON files and reports which posts are new,
 * which disappeared, and the overlap ratio. Always exits 0; prints a verdict.
 *
 * Run with:  pnpm tsx experiments/grok-x-reliability/diff-runs.ts [earlier.json] [later.json]
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CitedPost, RunDiff, RunRecord } from "./types";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(THIS_DIR, "runs");

async function listRunFiles(): Promise<string[]> {
  const entries = await readdir(RUNS_DIR).catch(() => []);
  return entries
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(RUNS_DIR, name));
}

async function readRun(path: string): Promise<RunRecord> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as RunRecord;
}

/** The identity of a post for diffing: the thread url when present, else its id. */
function postKey(post: CitedPost): string {
  return post.url ?? post.id;
}

type PostDiff = {
  newPosts: CitedPost[];
  disappearedPosts: CitedPost[];
  retainedPosts: CitedPost[];
};

function diffPosts(earlier: CitedPost[], later: CitedPost[]): PostDiff {
  const earlierKeys = new Map(earlier.map((p) => [postKey(p), p]));
  const laterKeys = new Map(later.map((p) => [postKey(p), p]));

  const newPosts = later.filter((p) => !earlierKeys.has(postKey(p)));
  const disappearedPosts = earlier.filter((p) => !laterKeys.has(postKey(p)));
  const retainedPosts = later.filter((p) => earlierKeys.has(postKey(p)));
  return { newPosts, disappearedPosts, retainedPosts };
}

function printPosts(title: string, posts: CitedPost[]): void {
  console.log(`\n${title} (${posts.length}):`);
  if (!posts.length) {
    console.log("  (none)");
    return;
  }
  for (const post of posts) {
    const who = post.author ? `@${post.author}` : "(unknown)";
    const snippet = post.text ? post.text.slice(0, 90) : "(no snippet)";
    console.log(`  - ${who}: ${snippet}`);
    console.log(`    ${post.url ?? "(no url)"}`);
  }
}

async function main(): Promise<void> {
  const [earlierArg, laterArg] = process.argv.slice(2);

  let earlierPath = earlierArg;
  let laterPath = laterArg;

  if (!earlierPath || !laterPath) {
    const files = await listRunFiles();
    if (files.length < 2) {
      console.log(
        `[diff] need at least 2 runs in experiments/grok-x-reliability/runs/ (found ${files.length}).`,
      );
      console.log("[diff] run `pnpm grok:scan` twice, then re-run this.");
      return;
    }
    laterPath = files[files.length - 1];
    earlierPath = files[files.length - 2];
  }

  const earlier = await readRun(earlierPath);
  const later = await readRun(laterPath);

  const { newPosts, disappearedPosts, retainedPosts } = diffPosts(
    earlier.response.posts,
    later.response.posts,
  );

  const maxCount = Math.max(earlier.response.posts.length, later.response.posts.length);
  const overlapRatio = maxCount === 0 ? 0 : retainedPosts.length / maxCount;

  const result: RunDiff = {
    earlierRunId: earlier.runId,
    laterRunId: later.runId,
    newPosts,
    disappearedPosts,
    retainedPosts,
    earlierPostCount: earlier.response.posts.length,
    laterPostCount: later.response.posts.length,
    overlapRatio,
  };

  console.log("══ Grok X reliability diff ═══════════════════");
  console.log(`earlier: ${earlier.runId} (${earlier.response.posts.length} posts)`);
  console.log(`later  : ${later.runId} (${later.response.posts.length} posts)`);
  console.log(`topic  : ${later.topic}`);
  console.log("");
  console.log(`retained : ${retainedPosts.length}`);
  console.log(`new      : ${newPosts.length}`);
  console.log(`gone     : ${disappearedPosts.length}`);
  console.log(`overlap  : ${(overlapRatio * 100).toFixed(1)}%`);

  printPosts("NEW posts (in later, not earlier)", newPosts);
  printPosts("DISAPPEARED posts (in earlier, not later)", disappearedPosts);
  printPosts("RETAINED posts (in both)", retainedPosts);

  console.log("\n── Verdict ───────────────────────────────────");
  if (maxCount === 0) {
    console.log("Both runs returned 0 posts — inconclusive for recall stability.");
  } else if (overlapRatio >= 0.8) {
    console.log("HIGH overlap: recall is stable across these two scans.");
  } else if (overlapRatio >= 0.5) {
    console.log("MEDIUM overlap: recall fluctuates noticeably between scans.");
  } else {
    console.log("LOW overlap: recall is unstable; the same scan finds different posts.");
  }
  console.log("══════════════════════════════════════════════");

  // Always exit 0; this is a reporting tool.
}

main().catch((err) => {
  console.error(`[diff] fatal: ${err instanceof Error ? err.message : String(err)}`);
});
