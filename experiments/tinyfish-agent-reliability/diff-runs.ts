/**
 * TinyFish Agent reliability — diff two runs of the same sub-test.
 *
 * Compares the two most recent run files for a sub-test and reports new, gone,
 * and retained identities plus an overlap ratio. Always exits 0.
 *
 * Run with:
 *   pnpm tsx experiments/tinyfish-agent-reliability/diff-runs.ts subreddit
 *   pnpm tsx experiments/tinyfish-agent-reliability/diff-runs.ts youtube [earlier.json] [later.json]
 */

import type { RunDiff, RunRecord, SubTest } from "./types";
import { listRunFiles, readRun } from "./lib";

const SUB_TESTS: SubTest[] = ["subreddit", "authority", "youtube"];

/** The identity used for recall diffing, per sub-test. */
function identityOf(record: RunRecord): string[] {
  const r = record.response;
  switch (record.subTest) {
    case "subreddit":
      return r.subredditThreads.map((t) => t.url || t.id);
    case "authority":
      return r.authorityVoices.map((v) => v.sourceUrl || `${v.author}:${v.advice.slice(0, 40)}`);
    case "youtube":
      return r.youtubeVideos.map((v) => v.videoId || v.url);
  }
}

function diff(earlier: string[], later: string[]): Omit<RunDiff, "subTest" | "earlierRunId" | "laterRunId"> {
  const earlierSet = new Set(earlier);
  const laterSet = new Set(later);
  const retainedIds = later.filter((id) => earlierSet.has(id));
  const newIds = later.filter((id) => !earlierSet.has(id));
  const goneIds = earlier.filter((id) => !laterSet.has(id));
  const maxCount = Math.max(earlier.length, later.length);
  return {
    newIds,
    goneIds,
    retainedIds,
    earlierCount: earlier.length,
    laterCount: later.length,
    overlapRatio: maxCount === 0 ? 0 : retainedIds.length / maxCount,
  };
}

function verdict(ratio: number, maxCount: number): string {
  if (maxCount === 0) return "Both runs returned 0 results — inconclusive.";
  if (ratio >= 0.8) return "HIGH overlap: recall is stable.";
  if (ratio >= 0.5) return "MEDIUM overlap: recall fluctuates noticeably.";
  return "LOW overlap: recall is unstable.";
}

async function main(): Promise<void> {
  const subTestArg = process.argv[2]?.trim() as SubTest | undefined;
  const subTest = subTestArg && SUB_TESTS.includes(subTestArg) ? subTestArg : "subreddit";

  let earlierPath = process.argv[3];
  let laterPath = process.argv[4];
  if (!earlierPath || !laterPath) {
    const files = await listRunFiles(subTest);
    if (files.length < 2) {
      console.log(`[diff] need at least 2 ${subTest} runs (found ${files.length}).`);
      return;
    }
    laterPath = files[files.length - 1];
    earlierPath = files[files.length - 2];
  }

  const earlier = await readRun(earlierPath);
  const later = await readRun(laterPath);
  const result: RunDiff = {
    subTest,
    earlierRunId: earlier.runId,
    laterRunId: later.runId,
    ...diff(identityOf(earlier), identityOf(later)),
  };

  console.log("══ TinyFish Agent reliability diff ═══════════");
  console.log(`sub-test: ${subTest}`);
  console.log(`earlier : ${earlier.runId} (${result.earlierCount})`);
  console.log(`later   : ${later.runId} (${result.laterCount})`);
  console.log("");
  console.log(`retained : ${result.retainedIds.length}`);
  console.log(`new      : ${result.newIds.length}`);
  console.log(`gone     : ${result.goneIds.length}`);
  console.log(`overlap  : ${(result.overlapRatio * 100).toFixed(1)}%`);
  console.log("");
  console.log("── Verdict ───────────────────────────────────");
  console.log(verdict(result.overlapRatio, Math.max(result.earlierCount, result.laterCount)));
  console.log("══════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(`[diff] fatal: ${err instanceof Error ? err.message : String(err)}`);
});
