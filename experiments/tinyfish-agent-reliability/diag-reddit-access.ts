/**
 * Diagnostic (not part of the protocol): isolate whether the TinyFish agent
 * can read Reddit at all, and whether the "lite" vs "stealth" browser profile
 * changes the outcome. Uses a known-active subreddit, not the test topic.
 *
 * Run with:
 *   pnpm tsx experiments/tinyfish-agent-reliability/diag-reddit-access.ts [lite|stealth]
 */

import { createClient, redact, runStructuredAgent, loadLocalEnv } from "./lib";

const SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    blocked: { type: "boolean" },
    threads: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["blocked", "threads"],
};

async function main(): Promise<void> {
  loadLocalEnv();
  const profile = (process.argv[2]?.trim() === "stealth" ? "stealth" : "lite") as
    | "lite"
    | "stealth";
  const url = "https://www.reddit.com/r/LocalLLaMA/top/?t=week";
  const goal = [
    `Open ${url}.`,
    "Report whether Reddit served the page or blocked you (login wall, network security block, or captcha).",
    "List up to 5 thread titles you can actually see.",
    "Set blocked=true if you could not read threads.",
  ].join("\n");

  console.log(`[diag] profile=${profile} url=${url}`);
  const client = createClient();
  const response = await runStructuredAgent(client, {
    goal,
    url,
    outputSchema: SCHEMA,
    browserProfile: profile,
  });
  console.log(`[diag] status=${response.status} steps=${response.num_of_steps}`);
  console.log(`[diag] result=${JSON.stringify(response.result)}`);
  if (response.error) console.error(`[diag] error=${redact(response.error.message)}`);
}

main().catch((err) => {
  console.error(`[diag] fatal: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
