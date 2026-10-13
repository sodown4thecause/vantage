import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/worktrees holds agent checkouts of this repo; their tests are not ours.
    exclude: [...configDefaults.exclude, ".claude/**", "test/worker-entry.test.mjs", "test/scan-run.test.mjs", "test/queue-consumer.test.mjs"],
    setupFiles: ["./test/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
