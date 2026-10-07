import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Destination } from "@/lib/db/schema";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  fail: false,
  calls: [] as string[],
}));

vi.mock("@/lib/db/client", () => {
  // Chainable, awaitable query builder: every method returns the same builder.
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      state.calls.push(m);
      void args;
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    (state.fail ? Promise.reject(new Error("db down")) : Promise.resolve(state.rows)).then(resolve, reject);
  return { getDb: () => builder };
});

import { default as LaunchIndex } from "@/app/launch/page";
import { default as sitemap } from "@/app/sitemap";
import { humanize, isStale, requirementLines } from "@/lib/destinations/labels";
import {
  getDestinationBySlug,
  listDestinationChanges,
  listDestinations,
} from "@/lib/destinations/repository";
import { validateCatalog, validateDestination } from "@/lib/destinations/validate";

const valid = {
  slug: "example-hunt",
  name: "Example Hunt",
  url: "https://example.com/",
  kind: "launch_platform",
  sourceUrl: "https://example.com/faq",
  lastVerified: "2026-10-07",
};

function row(overrides: Partial<Destination> = {}): Destination {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "example-hunt",
    name: "Example Hunt",
    url: "https://example.com/",
    kind: "launch_platform",
    audienceTags: [],
    categoryTags: [],
    cost: "unknown",
    priceNote: "",
    listingMode: "unknown",
    requirements: {},
    submissionsOpen: "unknown",
    submissionUrl: null,
    linkAttr: "unknown",
    aiCited: "unknown",
    aiCitedEvidence: null,
    sourceUrl: "https://example.com/faq",
    lastVerified: "2026-10-07",
    verifiedBy: "",
    notes: "",
    ...overrides,
  };
}

beforeEach(() => {
  state.rows = [];
  state.fail = false;
  state.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("validateDestination", () => {
  it("accepts a minimal row and defaults every unverified fact to unknown", () => {
    const result = validateDestination(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row).toMatchObject({
      cost: "unknown",
      listingMode: "unknown",
      submissionsOpen: "unknown",
      linkAttr: "unknown",
      aiCited: "unknown",
      audienceTags: [],
    });
  });

  it("rejects a row without sourceUrl", () => {
    const { sourceUrl: _omit, ...rest } = valid;
    void _omit;
    const result = validateDestination(rest);
    expect(result).toEqual({ ok: false, errors: expect.arrayContaining([expect.stringContaining("sourceUrl")]) });
  });

  it("rejects a row without lastVerified or with a malformed date", () => {
    const { lastVerified: _omit, ...rest } = valid;
    void _omit;
    expect(validateDestination(rest).ok).toBe(false);
    expect(validateDestination({ ...valid, lastVerified: "2026-13-40" }).ok).toBe(false);
    expect(validateDestination({ ...valid, lastVerified: "7 Oct 2026" }).ok).toBe(false);
  });

  it("rejects non-http source and submission URLs", () => {
    expect(validateDestination({ ...valid, sourceUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateDestination({ ...valid, submissionUrl: "ftp://example.com" }).ok).toBe(false);
  });

  it("allows explicit unknown values", () => {
    const result = validateDestination({ ...valid, cost: "unknown", linkAttr: "unknown", aiCited: "unknown" });
    expect(result.ok).toBe(true);
  });

  it("rejects values outside the enums", () => {
    expect(validateDestination({ ...valid, cost: "cheap" }).ok).toBe(false);
    expect(validateDestination({ ...valid, kind: "forum" }).ok).toBe(false);
  });

  it("requires evidence for ai_cited yes", () => {
    expect(validateDestination({ ...valid, aiCited: "yes" }).ok).toBe(false);
    expect(validateDestination({ ...valid, aiCited: "yes", aiCitedEvidence: "  " }).ok).toBe(false);
    const ok = validateDestination({
      ...valid,
      aiCited: "yes",
      aiCitedEvidence: "query: best devtool launch sites; engine: example; date: 2026-10-07",
    });
    expect(ok.ok).toBe(true);
  });

  it("rejects non-objects and bad slugs", () => {
    expect(validateDestination(null).ok).toBe(false);
    expect(validateDestination({ ...valid, slug: "Bad Slug" }).ok).toBe(false);
  });
});

describe("validateCatalog and the seeded data file", () => {
  it("flags duplicate slugs", () => {
    const { rows, errors } = validateCatalog([valid, valid]);
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, errors: ["duplicate slug"] });
  });

  it("data/destinations.json passes validation, is small and every row cites a source", () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "destinations.json"), "utf8")) as unknown;
    const { rows, errors } = validateCatalog(raw);
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(15);
    for (const r of rows) {
      expect(r.sourceUrl).toMatch(/^https:\/\//);
      expect(r.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The seed makes no AI-citation claims without recorded evidence.
      expect(r.aiCited).toBe("unknown");
    }
  });
});

describe("destination repository (mocked db)", () => {
  it("lists destinations", async () => {
    state.rows = [row()];
    expect(await listDestinations()).toHaveLength(1);
    expect(state.calls).toContain("orderBy");
  });

  it("filters by kind", async () => {
    state.rows = [row()];
    await listDestinations({ kind: "marketplace" });
    expect(state.calls).toContain("where");
  });

  it("returns a row by slug and null when missing", async () => {
    state.rows = [row()];
    expect((await getDestinationBySlug("example-hunt"))?.slug).toBe("example-hunt");
    state.rows = [];
    expect(await getDestinationBySlug("missing")).toBeNull();
  });

  it("does not query the database for a malformed slug", async () => {
    expect(await getDestinationBySlug("../etc/passwd")).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("lists pending changes", async () => {
    state.rows = [{ id: "c1", status: "pending" }];
    expect(await listDestinationChanges()).toHaveLength(1);
    expect(state.calls).toContain("limit");
  });
});

describe("labels", () => {
  it("humanizes unknown as not verified", () => {
    expect(humanize("unknown")).toBe("Not verified");
    expect(humanize("launch_platform")).toBe("launch platform");
  });

  it("flags rows older than 90 days as stale", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(isStale("2026-10-01", now)).toBe(false);
    expect(isStale("2026-06-01", now)).toBe(true);
    expect(isStale("garbage", now)).toBe(true);
  });

  it("renders only string, boolean and string-list requirements", () => {
    expect(requirementLines({ a_b: "x", c: true, d: ["p", "q"], e: { nested: 1 }, f: "" })).toEqual([
      "a b: x",
      "c: yes",
      "d: p; q",
    ]);
  });
});

describe("/launch page and sitemap", () => {
  it("shows a graceful empty state", async () => {
    state.rows = [];
    const html = renderToStaticMarkup(await LaunchIndex());
    expect(html).toContain("launch-empty");
    expect(html).toContain("No destinations have been verified yet");
  });

  it("shows an error state, not an empty catalog, when the database fails", async () => {
    state.fail = true;
    const html = renderToStaticMarkup(await LaunchIndex());
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("No destinations have been verified yet");
  });

  it("lists rows with a link to the detail page", async () => {
    state.rows = [row()];
    const html = renderToStaticMarkup(await LaunchIndex());
    expect(html).toContain("/launch/example-hunt");
    expect(html).toContain("Last verified 2026-10-07");
  });

  it("includes /launch and each detail page in the sitemap, and survives a db failure", async () => {
    state.rows = [row()];
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/launch"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/launch/example-hunt"))).toBe(true);
    state.fail = true;
    const fallback = await sitemap();
    expect(fallback).toHaveLength(1);
  });
});
