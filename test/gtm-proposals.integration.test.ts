import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gtmPostgresFixture, hasGtmTestDatabase } from "./gtm-postgres-fixture";
const context = vi.hoisted(() => ({ db: null as unknown, userId: "gtm-test-owner" }));
vi.mock("@/lib/db/client", () => ({ getDb: () => context.db }));
vi.mock("@/lib/auth/workspace", () => ({ authorizeWorkspace: async () => ({ ok: true, userId: context.userId }) }));
import { createStrategyProposal, getStrategyState } from "@/lib/gtm/proposals/repository";
import { persistSourceWithinLimit, PROFILE_SOURCE_NAME } from "@/lib/sources/persist";
import { provisionProfileSources } from "@/lib/profile/repository";
import { assertWithinCount } from "@/lib/plans/limits";
import { applyStrategyProposal } from "@/lib/gtm/proposals/apply";
import { POST } from "@/app/api/gtm/proposals/[id]/route";
import type { StrategyChange, StrategyProposal } from "@/lib/gtm/proposals/types";

describe.skipIf(!hasGtmTestDatabase)("Postgres proposal atomicity", () => {
  let fixture: Awaited<ReturnType<typeof gtmPostgresFixture>>;
  beforeAll(async () => { fixture = await gtmPostgresFixture(); context.db = fixture.db; }, 60_000);
  afterAll(async () => { await fixture?.close(); });
  const profile: StrategyChange = { profile: { productUrl: "https://example.com", docsUrls: [], productDescription: "Product", targetCustomer: "Founders", competitors: ["A", "B", "C"], topics: ["CRM"] } };
  const make = async (payload: StrategyChange = profile) => { const scope = await fixture.seed(); return createStrategyProposal({ ...scope, strategyVersion: 0, payload }); };
  const args = (p: StrategyProposal, requestId = "click-1") => ({ workspaceId: p.workspaceId, conversationId: p.conversationId, proposalId: p.id, strategyVersion: p.strategyVersion, requestId });
  const decide = (p: StrategyProposal, requestId = "click-1", approved = true, overrides: Record<string, unknown> = {}) => POST(new Request(`https://contextfor.dev/api/gtm/proposals/${p.id}`, { method: "POST", headers: { origin: "https://contextfor.dev", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: p.workspaceId, conversationId: p.conversationId, strategyVersion: p.strategyVersion, payloadHash: p.payloadHash, requestId, state: "approval-responded", approval: { id: p.id, approved }, ...overrides }) }), { params: Promise.resolve({ id: p.id }) });
  const counts = async (p: StrategyProposal) => (await fixture.client`select (select count(*)::int from monitoring_profile where workspace_id = ${p.workspaceId}) profiles, (select count(*)::int from source where workspace_id = ${p.workspaceId}) sources, (select count(*)::int from scan_run where workspace_id = ${p.workspaceId}) jobs, (select count(*)::int from gtm_proposal_receipt where workspace_id = ${p.workspaceId}) receipts, (select count(*)::int from gtm_strategy_outbox where workspace_id = ${p.workspaceId}) outbox, (select version from gtm_strategy where workspace_id = ${p.workspaceId}) version`)[0];

  it("requires real exact user confirmation and profile-only approval adds no sources/jobs", async () => {
    const p = await make();
    await expect(applyStrategyProposal(args(p, "model"))).rejects.toThrow("unconfirmed");
    expect((await decide(p, "bad-hash", true, { payloadHash: "0".repeat(64) })).status).toBe(409);
    expect((await decide(p)).status).toBe(200);
    expect(await counts(p)).toEqual({ profiles: 1, sources: 0, jobs: 0, receipts: 1, outbox: 1, version: 1 });
    expect((await fixture.client`select count(*)::int n from cost_event where workspace_id = ${p.workspaceId}`)[0]!.n).toBe(0);
    expect((await fixture.client`select count(*)::int n from workspace_usage where workspace_id = ${p.workspaceId}`)[0]!.n).toBe(0);
  });
  it("concurrent exact retries return one applied result, one replay and one outbox", async () => {
    const p = await make();
    const responses = await Promise.all([decide(p), decide(p)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map(r => r.json()));
    expect(bodies.map(b => b.replayed).sort()).toEqual([false, true]);
    expect(await counts(p)).toMatchObject({ profiles: 1, receipts: 1, outbox: 1, version: 1 });
    expect((await decide(p, "different-click")).status).toBe(409);
  });
  it("two competing conversations have exactly one winner", async () => {
    const p = await make();
    const secondConversation = crypto.randomUUID();
    await fixture.client`insert into seo_conversation (id, workspace_id) values (${secondConversation}, ${p.workspaceId})`;
    const other = await createStrategyProposal({ workspaceId: p.workspaceId, conversationId: secondConversation, strategyVersion: 0, payload: { ...profile, keywords: ["sales"], profile: { ...profile.profile, topics: undefined } } });
    const responses = await Promise.all([decide(p), decide(other, "other")]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await counts(p)).toMatchObject({ profiles: 1, receipts: 1, outbox: 1, version: 1 });
  });
  it("revisions supersede old approvals and rejects stale profiles, expired, denied and foreign scopes", async () => {
    const p = await make();
    const revised = await createStrategyProposal({ workspaceId: p.workspaceId, conversationId: p.conversationId, strategyVersion: 0, payload: { exclusions: ["competitors"] } });
    expect((await decide(p)).status).toBe(409);
    expect((await decide(revised, "denied", false)).status).toBe(200);
    expect((await decide(revised, "late-yes")).status).toBe(409);
    const expired = await make();
    await fixture.client`update gtm_proposal set expires_at = now() - interval '1 second' where id = ${expired.id}`;
    expect((await decide(expired)).status).toBe(409);
    const stale = await make();
    await fixture.client`insert into monitoring_profile (workspace_id, version, product_url, product_description, target_customer) values (${stale.workspaceId}, 1, 'https://example.com', 'Legacy edit', 'Founder')`;
    expect((await decide(stale)).status).toBe(409);
    const foreign = await fixture.seed();
    expect((await decide(stale, "foreign", true, { workspaceId: foreign.workspaceId })).status).toBe(409);
    expect((await decide(stale, "foreign-conversation", true, { conversationId: foreign.conversationId })).status).toBe(409);
    expect(await counts(revised)).toMatchObject({ profiles: 0, receipts: 0, outbox: 0, version: 0 });
    expect(await counts(stale)).toMatchObject({ profiles: 1, receipts: 0, outbox: 0, version: 0 });
  });
  it("a domain constraint failure rolls back every mutation, version, receipt and outbox", async () => {
    const p = await make({ ...profile, sources: [{ type: "hn", config: { query: "CRM" }, enabled: false }, { type: "hn", config: { query: "CRM" }, enabled: true }] });
    expect((await decide(p)).status).toBe(500);
    await expect(applyStrategyProposal(args(p))).rejects.toMatchObject({ code: "23505", constraint_name: "source_workspace_name_uidx" });
    expect(await counts(p)).toEqual({ profiles: 0, sources: 0, jobs: 0, receipts: 0, outbox: 0, version: 0 });
    expect((await fixture.client`select status from gtm_proposal where id = ${p.id}`)[0]!.status).toBe("pending");
  });
  it("applies explicit sources and expertise with server actor/time/version and enforces plan caps", async () => {
    const p = await make({ ...profile, expertiseNotes: [{ text: "Owned expertise", evidenceIds: [] }], sources: [{ type: "hn", config: { query: "CRM" }, enabled: false }] });
    expect((await decide(p)).status).toBe(200);
    expect((await fixture.client`select health from source where workspace_id = ${p.workspaceId}`)[0]!.health).toBe("paused");
    expect((await fixture.client`select actor_id, strategy_version, confirmed_at is not null confirmed from gtm_proposal_receipt where proposal_id = ${p.id}`)[0]).toEqual({ actor_id: "gtm-test-owner", strategy_version: 1, confirmed: true });
    const capped = await make({ profile: { ...profile.profile, topics: ["a", "b", "c", "d", "e", "f"] } });
    expect((await decide(capped)).status).toBe(409);
    expect(await counts(capped)).toMatchObject({ profiles: 0, receipts: 0, outbox: 0, version: 0 });
  });
  it("bounds lock contention, rolls back and permits the same request to retry", async () => {
    const p = await make();
    let acquired!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const blocker = fixture.client.begin(async tx => { await tx`lock table source in share row exclusive mode`; acquired(); await held; });
    // postgres-js transactions are lazy promises.
    const running = Promise.resolve(blocker);
    await ready;
    try {
      const response = await decide(p);
      expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("1");
      expect(await counts(p)).toMatchObject({ profiles: 0, receipts: 0, outbox: 0, version: 0 });
    } finally { release(); await running; }
    expect((await decide(p)).status).toBe(200);
    expect(await counts(p)).toMatchObject({ profiles: 1, receipts: 1, outbox: 1, version: 1 });
  }, 15_000);
  it("source edits are scoped, explicit and reject a changed source snapshot", async () => {
    const p = await make({ sources: [{ type: "hn", config: { query: "CRM" }, enabled: false }] });
    expect((await decide(p)).status).toBe(200);
    const [source] = await fixture.client`select id from source where workspace_id = ${p.workspaceId}`;
    const edit = await createStrategyProposal({ workspaceId: p.workspaceId, conversationId: p.conversationId, strategyVersion: 1, payload: { sources: [{ sourceId: source!.id, type: "hn", config: { query: "sales" }, enabled: false }] } });
    expect((await decide(edit, "edit")).status).toBe(200);
    const [changed] = await fixture.client`select config, health from source where id = ${source!.id}`;
    expect(changed).toMatchObject({ config: { queries: ["sales"] }, health: "paused" });
    const stale = await createStrategyProposal({ workspaceId: p.workspaceId, conversationId: p.conversationId, strategyVersion: 2, payload: { exclusions: ["noise"] } });
    await fixture.client`update source set health = 'healthy' where id = ${source!.id}`;
    expect((await decide(stale, "stale-source")).status).toBe(409);
    expect(await counts(p)).toMatchObject({ profiles: 0, sources: 1, receipts: 2, outbox: 2, version: 2 });
  });
  it("ignores scan telemetry but never overwrites a legacy writer racing approval", async () => {
    const p = await make({ sources: [{ type: "hn", config: { query: "CRM" }, enabled: true }] });
    expect((await decide(p)).status).toBe(200);
    const next = await createStrategyProposal({ workspaceId: p.workspaceId, conversationId: p.conversationId, strategyVersion: 1, payload: { exclusions: ["spam"] } });
    await fixture.client`update source set health = 'degraded', config = config || '{"lastRun":{"inserted":3}}'::jsonb, cursor = 'new cursor', last_polled_at = now(), updated_at = now() where workspace_id = ${p.workspaceId}`;
    expect((await decide(next, "telemetry")).status).toBe(200);

    const racing = await make();
    // Hold the legacy writer precisely between an already-recorded user decision and atomic apply.
    await fixture.client`insert into gtm_proposal_decision (workspace_id, conversation_id, proposal_id, strategy_version, payload_hash, request_id, actor_id, approved) values (${racing.workspaceId}, ${racing.conversationId}, ${racing.id}, 0, ${racing.payloadHash}, 'race', 'gtm-test-owner', true)`;
    let acquired!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const writer = Promise.resolve(fixture.client.begin(async tx => {
      await tx`insert into monitoring_profile (workspace_id, version, product_url, product_description, target_customer) values (${racing.workspaceId}, 1, 'https://example.com', 'Concurrent legacy edit', 'Founder')`;
      acquired(); await held;
    }));
    await ready;
    const applying = applyStrategyProposal(args(racing, "race")).then(result => ({ result, error: null }), error => ({ result: null, error }));
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const [row] = await fixture.client`select exists(select 1 from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'monitoring_profile' and l.mode = 'ShareRowExclusiveLock' and not l.granted) waiting`;
        if (row!.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); await writer; }
    expect((await applying).error).toMatchObject({ name: "ProposalConflictError" });
    expect(await counts(racing)).toMatchObject({ profiles: 1, receipts: 0, outbox: 0, version: 0 });
    expect((await fixture.client`select product_description from monitoring_profile where workspace_id = ${racing.workspaceId}`)[0]!.product_description).toBe("Concurrent legacy edit");
  }, 15_000);
  it("composes canonical domain state across profile patches, aliases and consecutive source additions", async () => {
    const initial = await make();
    expect((await decide(initial)).status).toBe(200);
    const scope = { workspaceId: initial.workspaceId, conversationId: initial.conversationId };
    const changes: StrategyChange[] = [{ profile: { productDescription: "Revised" } }, { keywords: ["sales"], competitors: ["D", "E", "F"] }, { sources: [{ type: "hn", config: { query: "sales" }, enabled: true }] }, { sources: [{ type: "rss", config: { feedUrl: "https://example.com/feed" }, enabled: false }] }];
    for (const [index, payload] of changes.entries()) {
      const p = await createStrategyProposal({ ...scope, strategyVersion: index + 1, payload });
      expect((await decide(p, `revision-${index}`)).status).toBe(200);
    }
    const state = await getStrategyState(scope);
    expect(state).toMatchObject({ strategyVersion: 5, keywords: ["sales"], competitors: ["D", "E", "F"], profile: { productUrl: "https://example.com", productDescription: "Revised", targetCustomer: "Founders", topics: ["sales"], competitors: ["D", "E", "F"] } });
    expect(state.sources).toHaveLength(2);
    expect(state.sources.map(s => s.enabled).sort()).toEqual([false, true]);
    const [stored] = await fixture.client`select data from gtm_strategy where workspace_id = ${scope.workspaceId}`;
    expect(stored!.data).toEqual({});
    const foreign = await fixture.seed();
    await expect(getStrategyState({ ...scope, conversationId: foreign.conversationId })).rejects.toThrow();
    await expect(getStrategyState({ ...scope, workspaceId: foreign.workspaceId })).rejects.toThrow();
  });
  it("persists forced manual material over retrieved content with empty and nonempty replacements", async () => {
    const initial = await make();
    expect((await decide(initial)).status).toBe(200);
    await fixture.client`update monitoring_profile set product_material_status = 'ok', product_material_text = 'Retrieved' where workspace_id = ${initial.workspaceId}`;
    for (const [index, manual] of ["", "Owner supplied"].entries()) {
      const p = await createStrategyProposal({ workspaceId: initial.workspaceId, conversationId: initial.conversationId, strategyVersion: index + 1, payload: { profile: { forceManualMaterial: true, productMaterialManual: manual } } });
      expect((await decide(p, `manual-${index}`)).status).toBe(200);
      const [stored] = await fixture.client`select product_material_status status, product_material_text text from monitoring_profile where workspace_id = ${p.workspaceId} order by version desc limit 1`;
      expect(stored).toEqual({ status: "manual", text: manual });
    }
  });
  it("rechecks a paused legacy source add after proposal commit and reserves the default profile slot", async () => {
    const scope = await fixture.seed();
    await persistSourceWithinLimit(scope.workspaceId, { name: PROFILE_SOURCE_NAME, type: "hn", lane: "free", config: {} });
    for (let i = 0; i < 6; i++) await persistSourceWithinLimit(scope.workspaceId, { name: `existing-${i}`, type: "rss", lane: "free", config: { feedUrl: `https://example.com/${i}` } });
    // The old caller checked here, then could pause before INSERT. Its resumed write must check again atomically.
    await assertWithinCount(scope.workspaceId, "sources", 7);
    const p = await createStrategyProposal({ ...scope, strategyVersion: 0, payload: { sources: [{ type: "hn", config: { query: "last slot" }, enabled: true }] } });
    expect((await decide(p)).status).toBe(200);
    await expect(persistSourceWithinLimit(scope.workspaceId, { name: "late legacy add", type: "rss", lane: "free", config: {} })).rejects.toMatchObject({ key: "sources" });
    expect(await counts(p)).toMatchObject({ sources: 8 });

    const reserved = await make({ sources: Array.from({ length: 7 }, (_, i) => ({ type: "hn" as const, config: { query: `reserved-${i}` }, enabled: false })) });
    expect((await decide(reserved)).status).toBe(200);
    const eighth = await createStrategyProposal({ workspaceId: reserved.workspaceId, conversationId: reserved.conversationId, strategyVersion: 1, payload: { sources: [{ type: "hn", config: { query: "no room" }, enabled: true }] } });
    expect((await decide(eighth, "eighth")).status).toBe(409);
    await provisionProfileSources(reserved.workspaceId, ["CRM"]);
    expect(await counts(reserved)).toMatchObject({ sources: 8 });
    await provisionProfileSources(reserved.workspaceId, ["sales"]);
    expect((await fixture.client`select config from source where workspace_id = ${reserved.workspaceId} and name = ${PROFILE_SOURCE_NAME}`)[0]!.config).toMatchObject({ queries: ["sales"] });
  });
});
