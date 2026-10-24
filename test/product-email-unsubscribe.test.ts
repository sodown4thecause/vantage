import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ suppressed: false, enabled: true, failPersist: false, claims: new Map<string, { sentAt: boolean }>(), calls: [] as Array<Record<string, unknown>>, scopes: [] as unknown[], deletes: [] as unknown[][], allowedReads: 0 }));
vi.mock("@/lib/analytics/activation", () => ({ captureActivation: vi.fn(async () => {}) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: (scope: unknown) => ({ limit: async () => {
    state.scopes.push(scope);
    state.allowedReads++;
    return state.suppressed || !state.enabled ? [] : [{ id: "ws", email: "synthetic@example.com" }];
  } }) }) }),
  insert: () => ({ values: (value: { kind: string }) => ({ onConflictDoNothing: () => ({ returning: async () => {
    if (state.claims.has(value.kind)) return [];
    state.claims.set(value.kind, { sentAt: false });
    return [{ kind: value.kind }];
  } }) }) }),
  update: () => ({ set: (value: Record<string, unknown>) => ({ where: async (scope: unknown) => {
    if (state.failPersist) throw new Error("synthetic persist failure");
    state.scopes.push(scope);
    if (value.productEmailSuppressedAt) state.suppressed = true;
    if (value.digestEnabled === false) state.enabled = false;
    if (value.sentAt) for (const claim of state.claims.values()) claim.sentAt = true;
  } }) }),
  delete: () => ({ where: async (scope: unknown) => {
    state.scopes.push(scope);
    const params = new PgDialect().sqlToQuery(scope as Parameters<PgDialect["sqlToQuery"]>[0]).params;
    state.deletes.push(params as unknown[]);
    for (const [kind, claim] of state.claims) if (params.includes(kind) && !claim.sentAt) state.claims.delete(kind);
  } }),
}) }));

import { GET, POST } from "@/app/api/email/unsubscribe/route";
import { unsubscribeToken, verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { sendProductEmail } from "@/lib/email/product";
import { sendDigestEmail } from "@/lib/digest/send";
import { firstScanEmailChoice, sendFirstScanEmail } from "@/lib/email/activation";

const WS = "11111111-1111-4111-8111-111111111111";
const opportunity = { opportunityId: "synthetic-1", platform: "hn", title: "Synthetic question", url: "https://example.com/synthetic", score: 1, reason: "Synthetic evidence" };
beforeEach(() => {
  state.suppressed = false; state.enabled = true; state.failPersist = false; state.claims.clear(); state.calls = []; state.scopes = []; state.deletes = []; state.allowedReads = 0;
  vi.stubEnv("CRON_SECRET", "synthetic-signing-key-not-a-credential");
  vi.stubEnv("RESEND_API_KEY", "synthetic-mail-key");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { state.calls.push(JSON.parse(String(init.body))); return Response.json({ id: "mock" }); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("signed sessionless unsubscribe", () => {
  it("rejects malformed, tampered, expired and wrong-secret tokens without a write", async () => {
    const now = Date.now();
    const valid = unsubscribeToken(WS, now);
    expect(verifyUnsubscribeToken(valid, now)).toBe(WS);
    expect(verifyUnsubscribeToken(valid, now + 31 * 86400_000)).toBeNull();
    for (const token of ["bad", `${valid}x`, unsubscribeToken(WS, now - 31 * 86400_000)]) {
      expect((await POST(new Request(`https://example.com/api/email/unsubscribe?token=${token}`, { method: "POST" }))).status).toBe(400);
    }
    vi.stubEnv("CRON_SECRET", "different-synthetic-key");
    expect(verifyUnsubscribeToken(valid)).toBeNull();
    vi.stubEnv("CRON_SECRET", "");
    expect(verifyUnsubscribeToken(valid)).toBeNull();
    expect(state.scopes).toEqual([]);
  });

  it("GET only offers confirmation, RFC8058 POST without cookies durably suppresses later digest and activation mail", async () => {
    const url = `https://example.com/api/email/unsubscribe?token=${unsubscribeToken(WS)}`;
    expect((await GET(new Request(url))).status).toBe(200);
    expect(state.suppressed).toBe(false);
    const post = () => POST(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(state.suppressed).toBe(true);
    state.enabled = true;
    expect(await sendDigestEmail({ workspaceId: WS, to: "synthetic@example.com", previousDigestLastSentAt: null,
      opportunities: [opportunity], manageUrl: `https://example.com/settings/digest?workspaceId=${WS}` })).toMatchObject({ ok: true, skipped: true });
    await sendFirstScanEmail(WS, 1);
    expect(fetch).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(state.scopes[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(query.params).toContain(WS);
  });
});

describe("all product email delivery", () => {
  it("includes both RFC8058 headers, a signed footer, up to five genuine picks and app links before source links", async () => {
    expect(await sendDigestEmail({ workspaceId: WS, to: "synthetic@example.com", previousDigestLastSentAt: null,
      opportunities: Array.from({ length: 8 }, (_, index) => ({ ...opportunity, opportunityId: `synthetic-${index}` })),
      manageUrl: `https://example.com/settings/digest?workspaceId=${WS}` })).toEqual({ ok: true });
    const message = state.calls[0] as { from: string; headers: Record<string, string>; html: string; text: string; subject: string };
    expect(message.from).toContain("digest@updates.contextfor.dev");
    expect(message.subject).toContain("5 conversations");
    expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const unsubscribeUrl = new URL(message.headers["List-Unsubscribe"].match(/<(https?:[^>]+)>/)![1]!);
    expect(message.headers["List-Unsubscribe"]).toMatch(/^<mailto:[^>]+>, <https?:/);
    expect(verifyUnsubscribeToken(unsubscribeUrl.searchParams.get("token")!)).toBe(WS);
    expect(message.html).toContain("Unsubscribe");
    expect(message.html.indexOf("/opportunities/synthetic-0")).toBeLessThan(message.html.indexOf(opportunity.url));
    expect(message.text).toContain("src=email");
    expect(message.html).not.toContain("synthetic-5");
  });

  it("a sent-log claim blocks concurrent activation duplicates before the provider call", async () => {
    await Promise.all([sendFirstScanEmail(WS, 2), sendFirstScanEmail(WS, 2)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.claims.size).toBe(1);
    expect(state.calls[0]).toMatchObject({ subject: "Vantage: your first 2 conversations are ready" });
    expect((state.calls[0].headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("fails closed without an existing signing secret and never adds a new secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await sendProductEmail({ workspaceId: WS, to: "synthetic@example.com", idempotencyKey: "test", render: () => ({ subject: "test", text: "test", html: "test" }) })).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("releases the once-claim on a provider 5xx so a later attempt sends instead of blocking forever", async () => {
    const render = () => ({ subject: "test", text: "test", html: "test" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unavailable", { status: 502 })));
    expect(await sendProductEmail({ workspaceId: WS, to: "synthetic@example.com", idempotencyKey: "idem-5xx", once: "first_scan", render })).toMatchObject({ ok: false });
    expect(state.claims.size).toBe(0);
    expect(state.deletes[0]).toContain(WS);
    expect(state.deletes[0]).toContain("first_scan");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { state.calls.push(JSON.parse(String(init.body))); return Response.json({ id: "mock" }); }));
    expect(await sendProductEmail({ workspaceId: WS, to: "synthetic@example.com", idempotencyKey: "idem-5xx", once: "first_scan", render })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.claims.get("first_scan")).toEqual({ sentAt: true });
  });

  it("releases the claim when the provider never answers, keeps it on ambiguous 409 and on a persist failure after delivery", async () => {
    const render = () => ({ subject: "test", text: "test", html: "test" });
    const send = (idempotencyKey: string) => sendProductEmail({ workspaceId: WS, to: "synthetic@example.com", idempotencyKey, once: "first_scan", render });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(send("idem-net")).resolves.toMatchObject({ ok: false });
    expect(state.claims.size).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("conflict", { status: 409 })));
    await expect(send("idem-409")).resolves.toMatchObject({ ok: false });
    expect(state.claims.get("first_scan")).toEqual({ sentAt: false });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "mock" })));
    state.claims.clear();
    state.failPersist = true;
    await expect(send("idem-persist")).resolves.toMatchObject({ ok: false });
    expect(state.claims.get("first_scan")).toEqual({ sentAt: false });
  });

  it("chooses truthful nonempty and zero-result activation messages", () => {
    expect(firstScanEmailChoice(0).subject).toContain("nothing strong yet");
    expect(firstScanEmailChoice(1).subject).toContain("1 conversation is ready");
    expect(firstScanEmailChoice(9).subject).toContain("5 conversations are ready");
  });
});
