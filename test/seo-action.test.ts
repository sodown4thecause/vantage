import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeWorkspace: vi.fn(),
  fetchBacklinkSummary: vi.fn(),
  fetchReferringDomains: vi.fn(),
  fetchAnchors: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/workspace", () => ({
  authorizeWorkspace: mocks.authorizeWorkspace,
}));

vi.mock("@/lib/dataforseo/backlinks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataforseo/backlinks")>();
  return {
    ...actual,
    fetchBacklinkSummary: mocks.fetchBacklinkSummary,
    fetchReferringDomains: mocks.fetchReferringDomains,
    fetchAnchors: mocks.fetchAnchors,
  };
});

import { authorizeWorkspace } from "@/lib/auth/workspace";
import { fetchAnchors, fetchBacklinkSummary, fetchReferringDomains } from "@/lib/dataforseo/backlinks";
import { DataForSeoDeniedError, type DataForSeoDenial } from "@/lib/dataforseo/gate";
import { PaidCallDeniedError } from "@/lib/providers/paid-call";
import { PRIVATE_PATHS } from "@/lib/seo";
import { runBacklinkReport } from "@/app/seo/actions";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

/** Resolves with the URL passed to redirect(), or fails the test if the action returned normally. */
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
      return err.message.slice("REDIRECT:".length);
    }
    throw err;
  }
  throw new Error("expected the action to redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.authorizeWorkspace.mockResolvedValue({ ok: true, userId: "user-1" });
  for (const fn of [mocks.fetchBacklinkSummary, mocks.fetchReferringDomains, mocks.fetchAnchors]) {
    fn.mockReset();
    fn.mockResolvedValue({ value: [], cached: false });
  }
});

describe("runBacklinkReport", () => {
  it("refuses an unauthorized workspace before any fetch", async () => {
    mocks.authorizeWorkspace.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });

    const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com" })));

    expect(url).toBe("/seo?error=forbidden");
    expect(fetchBacklinkSummary).not.toHaveBeenCalled();
    expect(fetchReferringDomains).not.toHaveBeenCalled();
    expect(fetchAnchors).not.toHaveBeenCalled();
  });

  it("rejects an invalid target without fetching", async () => {
    const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "localhost" })));

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=localhost&error=invalid_target`);
    expect(fetchBacklinkSummary).not.toHaveBeenCalled();
    expect(fetchReferringDomains).not.toHaveBeenCalled();
    expect(fetchAnchors).not.toHaveBeenCalled();
  });

  it("rejects an invalid competitor without fetching the target", async () => {
    const url = await redirectOf(
      runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com", competitor: "localhost" })),
    );

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&competitor=localhost&error=invalid_target`);
    expect(fetchBacklinkSummary).not.toHaveBeenCalled();
    expect(fetchReferringDomains).not.toHaveBeenCalled();
  });

  it("keeps the normalized target when only the competitor is invalid", async () => {
    const url = await redirectOf(
      runBacklinkReport(
        form({ workspaceId: WORKSPACE, target: "https://www.Example.com/pricing", competitor: "localhost" }),
      ),
    );

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&competitor=localhost&error=invalid_target`);
    expect(fetchBacklinkSummary).not.toHaveBeenCalled();
  });

  it("authorizes before any fetch, then fetches the target and competitor and redirects with normalized domains", async () => {
    const url = await redirectOf(
      runBacklinkReport(
        form({
          workspaceId: WORKSPACE,
          target: "https://www.Example.com/pricing",
          competitor: "Rival.com",
        }),
      ),
    );

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&competitor=rival.com`);
    expect(fetchBacklinkSummary).toHaveBeenCalledWith(WORKSPACE, "example.com");
    expect(fetchReferringDomains).toHaveBeenCalledWith(WORKSPACE, "example.com");
    expect(fetchAnchors).toHaveBeenCalledWith(WORKSPACE, "example.com");
    expect(fetchReferringDomains).toHaveBeenCalledWith(WORKSPACE, "rival.com");
    expect(fetchReferringDomains).toHaveBeenCalledTimes(2);

    const authorizedAt = vi.mocked(authorizeWorkspace).mock.invocationCallOrder[0];
    const firstFetchAt = vi.mocked(fetchBacklinkSummary).mock.invocationCallOrder[0];
    expect(authorizedAt).toBeLessThan(firstFetchAt);
  });

  it("fetches only the target when no competitor is given", async () => {
    const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com", competitor: "" })));

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com`);
    expect(fetchBacklinkSummary).toHaveBeenCalledTimes(1);
    expect(fetchReferringDomains).toHaveBeenCalledTimes(1);
    expect(fetchAnchors).toHaveBeenCalledTimes(1);
  });

  it("maps a credits_exhausted denial to its error code and keeps the target", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new DataForSeoDeniedError("credits_exhausted", "x"));

    const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com" })));

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&error=credits_exhausted`);
    expect(fetchReferringDomains).not.toHaveBeenCalled();
  });

  it.each<DataForSeoDenial>(["not_configured", "credits_exhausted", "reserve_floor", "balance_unknown", "daily_cap"])(
    "passes the %s denial code through",
    async (code) => {
      mocks.fetchReferringDomains.mockRejectedValue(new DataForSeoDeniedError(code, "x"));

      const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com" })));

      expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&error=${code}`);
    },
  );

  it("maps a paid-call denial to paused", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new PaidCallDeniedError("budget_exhausted", "x"));

    const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com" })));

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&error=paused`);
  });

  it("maps any other failure to failed and keeps the competitor on a competitor-side error", async () => {
    mocks.fetchReferringDomains.mockImplementation(async (_workspace: string, target: string) => {
      if (target === "rival.com") throw new Error("upstream exploded");
      return { value: [], cached: false };
    });

    const url = await redirectOf(
      runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com", competitor: "rival.com" })),
    );

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&competitor=rival.com&error=failed`);
  });

  it("maps a generic error from the first fetch to failed", async () => {
    mocks.fetchBacklinkSummary.mockRejectedValue(new Error("boom"));

    const url = await redirectOf(runBacklinkReport(form({ workspaceId: WORKSPACE, target: "example.com" })));

    expect(url).toBe(`/seo?workspaceId=${WORKSPACE}&target=example.com&error=failed`);
  });
});

describe("/seo page is read-only", () => {
  it("never references a spending function, so a GET or prefetch cannot spend credits", () => {
    const source = readFileSync(fileURLToPath(new URL("../app/seo/page.tsx", import.meta.url)), "utf8");

    for (const name of ["fetchBacklinkSummary", "fetchReferringDomains", "fetchAnchors", "runDataForSeo"]) {
      expect(source).not.toContain(name);
    }
  });
});

describe("private paths", () => {
  it("keeps the signed-in /seo page out of the index", () => {
    expect(PRIVATE_PATHS).toContain("/seo");
  });
});
