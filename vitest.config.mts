import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/worktrees holds agent checkouts of this repo; their tests are not ours.
    exclude: [...configDefaults.exclude, ".claude/**", "test/worker-entry.test.mjs", "test/scan-run.test.mjs", "test/queue-consumer.test.mjs", "test/blog-worker.test.mjs"],
    setupFiles: ["./test/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // workerd builtin; resolved to a benign stub so vitest can load it before vi.mock kicks in.
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
