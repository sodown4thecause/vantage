import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Worker errors are monitored by Cloudflare Workers Issues, not an SDK. A deploy whose config omits
// observability.issues.enabled turns Issues off, so every deploy target must keep it.
describe("Workers Issues", () => {
  it("keeps issues, traces and logs enabled in every deployed environment", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"));
    for (const [target, samplingRate] of [
      [config, 0.2],
      [config.env.staging, 1],
      [config.env.production, 0.2],
    ] as const) {
      expect(target.observability.enabled).toBe(true);
      expect(target.observability.issues.enabled).toBe(true);
      expect(target.observability.traces).toEqual({ enabled: true, head_sampling_rate: samplingRate });
      expect(target.observability.logs).toEqual({ enabled: true, invocation_logs: true, head_sampling_rate: 1 });
    }
  });
});
