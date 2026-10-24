import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Worker errors are monitored by Cloudflare Workers Issues, not an SDK. A deploy whose config omits
// observability.issues.enabled turns Issues off, so every deploy target must keep it.
describe("Workers Issues", () => {
  it("is enabled at top level and for staging and production", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"));
    for (const target of [config, config.env.staging, config.env.production]) {
      expect(target.observability).toEqual({ enabled: true, issues: { enabled: true } });
    }
  });
});
