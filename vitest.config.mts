import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "test/worker-entry.test.mjs"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `cloudflare:workers` is supplied by the Workers runtime and cannot be
      // resolved under Node, so any module importing it fails to load in
      // vitest. Point it at the runtime stub that mirrors the surface our code
      // uses. Types come from `types/cloudflare-workers.d.ts` instead.
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
