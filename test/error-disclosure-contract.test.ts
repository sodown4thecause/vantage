import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public error disclosure contract", () => {
  it.each([
    "lib/collectors/route.ts",
    "app/api/pipeline/run/route.ts",
    "app/api/cron/tick/route.ts",
  ])("does not return caught exception messages from %s", (path) => {
    expect(read(path)).not.toContain("NextResponse.json({ error: message }");
  });

  it("does not render caught exception messages on the review page", () => {
    expect(read("app/review/page.tsx")).not.toContain(
      "error = err instanceof Error ? err.message : String(err)",
    );
  });
});
