import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), sources: vi.fn(), queue: vi.fn(), session: vi.fn(), select: vi.fn(), where: vi.fn(), usage: vi.fn(),
}));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: mocks.authorize, getCurrentWorkspace: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: mocks.session } }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: () => { throw new Error("NEXT_REDIRECT"); },
}));
vi.mock("@/lib/sources/list", () => ({ listWorkspaceSources: mocks.sources }));
vi.mock("@/lib/sources/recent", () => ({ listRecentPosts: async () => [] }));
vi.mock("@/lib/sources/subreddit-suggestions", () => ({ listSubredditSuggestions: async () => [] }));
vi.mock("@/lib/profile/repository", () => ({ getLatestMonitoringProfile: async () => null }));
vi.mock("@/lib/pipeline/run", () => ({ listReviewQueue: mocks.queue }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: mocks.select }) }));
vi.mock("@/lib/plans/limits", () => ({ getPlanUsage: mocks.usage }));
vi.mock("@/app/source-controls", () => ({
  CommunitySourceForm: () => null, FeedForm: () => null, SearchSourceForm: () => null,
  SourceScanButton: () => <button>Scan this source</button>, TrackSubredditButton: () => null,
}));
vi.mock("@/app/settings/plan/delete-workspace-form", () => ({ DeleteWorkspaceForm: () => null }));

import SourcesPage from "@/app/settings/sources/page";
import PlanPage from "@/app/settings/plan/page";
import ReviewPage from "@/app/review/page";
import PricingPage from "@/app/pricing/page";
import { SubscriptionControls, type SubscriptionState } from "@/app/settings/plan/subscription-controls";
import { sourceCoverageSentence } from "@/lib/sources/coverage-copy";
import type { SourceCoverageView } from "@/lib/sources/list";
import { BILLING_PLANS } from "@/lib/billing/products";
import { billingSubscription, source as sourceTable } from "@/lib/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";

const { listWorkspaceSources: readStoredSources } = await vi.importActual<typeof import("@/lib/sources/list")>("@/lib/sources/list");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const props = () => ({ searchParams: Promise.resolve({ workspaceId }) });
const source: SourceCoverageView = {
  id: "source-1", workspaceId, name: "Hacker News", type: "hn", lane: "free",
  health: "healthy", coverage: null, displayCoverage: null, pausedLabel: null,
  lastPolledAt: null, lastRun: null, collectorRegistered: true, etag: null, cursor: null,
};
const now = new Date("2026-10-24T00:00:00Z");
const subscription: SubscriptionState = {
  plan: "pro", status: "active", cancelAtPeriodEnd: true,
  currentPeriodEnd: new Date("2026-11-24T00:00:00Z"), endedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VANTAGE_ADMIN_USER_IDS", "admin-1");
  vi.stubEnv("POLAR_SERVER", "production");
  mocks.session.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.authorize.mockResolvedValue({ ok: true, userId: "owner-1" });
  mocks.sources.mockResolvedValue([source]);
  mocks.queue.mockResolvedValue([]);
  mocks.select.mockImplementation(() => ({ from: () => ({ where: mocks.where }) }));
  mocks.where.mockResolvedValue([]);
  mocks.usage.mockResolvedValue({ plan: "free", limits: { scan_interval_hours: 24 }, usage: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("plain-English coverage", () => {
  it.each([
    ["healthy", "The latest scan found 2 conversations."],
    ["degraded", "The latest scan found only partial coverage of this source."],
    ["access_pending", "Reading will start once access to this source is ready."],
    ["budget_limited", "Reading is temporarily limited because the scan allowance has been reached."],
    ["blocked", "This source is currently preventing us from reading conversations."],
    ["failed", "The latest scan could not finish; try scanning this source again."],
  ] as const)("maps %s without exposing technical reasons", (coverage, expected) => {
    expect(sourceCoverageSentence({ ...source, coverage, displayCoverage: coverage,
      lastRun: { coverage, health: coverage, resultCount: 2, inserted: 2, skipped: 0, provider: "private-provider", reason: "internal reason", ranAt: "" },
    })).toBe(expected);
  });

  it("handles pauses, unsupported sources and first scans", () => {
    expect(sourceCoverageSentence(source)).toBe("Ready to read conversations on the first scan.");
    expect(sourceCoverageSentence({ ...source, collectorRegistered: false })).toContain("Coming soon");
    expect(sourceCoverageSentence({ ...source, displayCoverage: "paused_global", collectorRegistered: false })).toBe("Reading from this source is paused.");
    expect(sourceCoverageSentence({ ...source, health: "paused" })).toBe("Reading from this source is paused.");
  });

  it("discloses incomplete coverage without making upstream calls on page load", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected upstream call"); });
    vi.stubGlobal("fetch", fetch);
    const html = renderToStaticMarkup(await SourcesPage(props()));
    expect(html).toContain("not every conversation");
    expect(html).toContain("stored scan results");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.sources).toHaveBeenCalledWith(workspaceId);
  });

  it("loads stored coverage through the real source reader without running a collector", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected upstream call"); });
    vi.stubGlobal("fetch", fetch);
    mocks.sources.mockImplementationOnce(readStoredSources);
    const where = vi.fn().mockResolvedValue([{ ...source, config: {}, lastPolledAt: null }]);
    mocks.select.mockImplementation(() => ({ from: (table: unknown) => table === sourceTable ? { where } : Promise.resolve([]) }));
    const html = renderToStaticMarkup(await SourcesPage(props()));
    expect(html).toContain("Ready to read conversations on the first scan.");
    expect(fetch).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"source"."workspace_id"');
    expect(query.params).toEqual([workspaceId]);
  });

  it("labels sample-only and zero-result scans honestly", () => {
    const lastRun = { coverage: "degraded", health: "degraded", resultCount: 0, inserted: 0, skipped: 0, provider: "fixture", reason: "synthetic", ranAt: "" } as const;
    expect(sourceCoverageSentence({ ...source, coverage: "degraded", lastRun })).toContain("Only sample conversations");
    expect(sourceCoverageSentence({ ...source, lastRun: { ...lastRun, coverage: "healthy", provider: "live" } })).toBe("The latest scan found 0 conversations.");
  });

  it("does not load source data for a foreign workspace", async () => {
    mocks.authorize.mockResolvedValue({ ok: false });
    await SourcesPage(props());
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it("keeps technical details out of ordinary users' HTML and removes the review link", async () => {
    mocks.sources.mockResolvedValue([{ ...source, displayCoverage: "paused_global", pausedLabel: "private-reason" }]);
    const html = renderToStaticMarkup(await SourcesPage(props()));
    expect(html).toContain("Reading from this source is paused.");
    for (const value of ["Details", "private-reason", "paused_global", "Provider", "/review?"]) expect(html).not.toContain(value);
  });

  it("puts diagnostics in a closed Details disclosure for admins only", async () => {
    mocks.authorize.mockResolvedValue({ ok: true, userId: "admin-1" });
    const html = renderToStaticMarkup(await SourcesPage(props()));
    expect(html).toContain("<details");
    expect(html).toContain(">Details</summary>");
    expect(html).toContain("Provider");
    expect(html).not.toContain("<details open");
  });
});

describe("review admin boundary", () => {
  it.each([null, { user: { id: "owner-1" } }])("rejects non-admin sessions before workspace or queue reads", async data => {
    mocks.session.mockResolvedValue({ data });
    await expect(ReviewPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("still requires workspace ownership for an admin", async () => {
    mocks.session.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mocks.authorize.mockResolvedValue({ ok: false });
    expect(renderToStaticMarkup(await ReviewPage(props()))).toContain("Unable to load this review queue.");
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("lets an authorised admin read only the requested workspace", async () => {
    mocks.session.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    await ReviewPage(props());
    expect(mocks.authorize).toHaveBeenCalledWith(workspaceId);
    expect(mocks.queue).toHaveBeenCalledWith(workspaceId);
  });
});

describe("plan states", () => {
  it("describes capped research and drafting without selling more daily picks", async () => {
    const html = renderToStaticMarkup(await PricingPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("capped research and drafting");
    expect(html).toContain("Coming soon");
    for (const value of ["scored conversations a day", "SEO agent questions", "SEO data credits", "deep searches a month", "community", "posting", "submitting", "voting", "list sends"]) expect(html).not.toContain(value);
  });

  it.each(["production", "sandbox"] as const)("uses the same POST checkout products as pricing in %s", server => {
    vi.stubEnv("POLAR_SERVER", server);
    const html = renderToStaticMarkup(<SubscriptionControls plan="free" subscriptions={[]} now={now} />);
    expect(html.match(/action="\/api\/billing\/checkout" method="post"/g)).toHaveLength(2);
    for (const plan of BILLING_PLANS) expect(html).toContain(plan.productIds[server]);
    expect(html).not.toContain("/api/billing/portal");
  });

  it("shows the cancellation date while retaining the management link", () => {
    const html = renderToStaticMarkup(<SubscriptionControls plan="pro" subscriptions={[subscription]} now={now} />);
    expect(html).toContain("Your plan ends on");
    expect(html).toContain("24 November 2026");
    expect(html).toContain('href="/api/billing/portal"');
    expect(html).not.toContain("/api/billing/checkout");
  });

  it("does not claim the workspace plan ends when an operator also granted Pro", () => {
    const html = renderToStaticMarkup(<SubscriptionControls plan="pro" subscriptions={[subscription]} operatorGranted now={now} />);
    expect(html).not.toContain("Your plan ends on");
  });

  it("uses the latest cancellation date across paid subscriptions", () => {
    const later = { ...subscription, currentPeriodEnd: new Date("2026-12-24T00:00:00Z") };
    const html = renderToStaticMarkup(<SubscriptionControls plan="pro" subscriptions={[subscription, later]} now={now} />);
    expect(html).toContain("24 December 2026");
  });

  it("shows the actual webhook end date after revocation, rather than a future period end", () => {
    const ended = { ...subscription, status: "canceled", endedAt: now };
    const html = renderToStaticMarkup(<SubscriptionControls plan="free" subscriptions={[ended]} now={now} />);
    expect(html).toContain("Your plan ended on");
    expect(html).toContain("24 October 2026");
    expect(html).not.toContain("24 November 2026");
  });

  it.each([
    [], [{ ...subscription, cancelAtPeriodEnd: false }], [{ ...subscription, status: "canceled", endedAt: now }],
    [{ ...subscription, currentPeriodEnd: null }], [{ ...subscription, currentPeriodEnd: now }],
    [subscription, { ...subscription, cancelAtPeriodEnd: false }],
  ].map(subscriptions => ({ subscriptions })))("does not invent an end date for active, expired or missing subscriptions: %j", ({ subscriptions }) => {
    expect(renderToStaticMarkup(<SubscriptionControls plan="pro" subscriptions={subscriptions} now={now} />)).not.toContain("Your plan ends on");
  });

  it("reads subscription state for the authorised owner only", async () => {
    await PlanPage(props());
    const query = mocks.where.mock.calls[1][0];
    const sql = new PgDialect().sqlToQuery(query);
    expect(sql.sql).toContain('"billing_subscription"."user_id"');
    expect(sql.params).toEqual(["owner-1"]);
    expect(mocks.select.mock.calls[1][0].status).toBe(billingSubscription.status);
  });

  it("does not read subscription or usage data for a foreign workspace", async () => {
    mocks.authorize.mockResolvedValue({ ok: false });
    await PlanPage(props());
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });
});
