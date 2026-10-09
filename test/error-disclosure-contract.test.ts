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

  it.each([
    "app/actions/workspace.ts",
    "app/actions/source.ts",
    "app/actions/lead.ts",
    "app/actions/outcome.ts",
    "app/actions/digest.ts",
  ])("returns only fixed or domain-validated errors from %s", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/return\s*\{\s*error:\s*err\b/);
    expect(source).not.toMatch(/return\s*\{\s*error:\s*String\(/);
    expect(source).not.toMatch(/return\s*\{\s*error:\s*message\b/);
    // Raw exception text may be logged internally, never returned.
    expect(source).not.toMatch(/return\s*\{[^}]*err\.message/);
  });

  it.each([
    "app/sources/page.tsx",
    "app/settings/page.tsx",
  ])("renders only a fixed access-denied message in %s", (path) => {
    expect(read(path)).toContain("You do not have access to this workspace.");
  });

  it("never sends raw provider payloads in the digest email", () => {
    const source = read("lib/digest/send.ts");
    expect(source).toContain("escapeHtml");
    expect(source).not.toContain("JSON.stringify(opportunities)");
  });
});
