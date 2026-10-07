/**
 * TinyFish Agent reliability — combined runner.
 *
 * Runs sub-tests A, B, and C sequentially in one process so a "sweep" is one
 * command. Each child writes its own runs/<ISO>-<subtest>.json.
 *
 * Run with:
 *   pnpm tinyfish:all ["topic"]
 *   # or
 *   pnpm tsx experiments/tinyfish-agent-reliability/run-all.ts ["topic"]
 *
 * Standalone and additive. Exits non-zero only if every sub-test errored.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SUB_TESTS = ["run-subreddit.ts", "run-authority.ts", "run-youtube.ts"];

async function runOne(script: string, topic: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(THIS_DIR, script), topic], {
      stdio: "inherit",
      env: process.env,
      cwd: join(THIS_DIR, "..", ".."),
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main(): Promise<void> {
  const topic = process.argv[2]?.trim() || "free AI GTM signal buzz tool";
  console.log(`[all] topic="${topic}"`);
  const codes: number[] = [];
  for (const script of SUB_TESTS) {
    const code = await runOne(script, topic);
    codes.push(code);
  }
  if (codes.every((code) => code !== 0)) {
    console.error("[all] every sub-test failed");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[all] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
