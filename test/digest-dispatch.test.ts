import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import type { DigestOpportunity } from "@/lib/digest/select";
import type { sendDigestEmail } from "@/lib/digest/send";
import type * as DigestSendModule from "@/lib/digest/send";

type DigestWorkspace = {
  id: string;
  digestEnabled: boolean;
  digestEmail: string | null;
  digestHourUtc: number;
  digestLastSentAt: Date | null;
  digestLeaseToken: string | null;
  digestLeaseUntil: Date | null;
  digestLastAttemptAt: Date | null;
};

const state = vi.hoisted(() => ({
  workspaces: [] as DigestWorkspace[],
  select: vi.fn<(workspaceId: string) => Promise<DigestOpportunity[]>>(),
  appUrl: vi.fn<() => string>(),
  send: vi.fn<typeof sendDigestEmail>(),
  record: vi.fn<(workspaceId: string, at: Date) => Promise<void>>(),
  fetch: vi.fn<typeof fetch>(),
  dbNow: new Date("2026-10-10T13:00:00.000Z"),
  writes: [] as { values: Record<string, unknown>; where: unknown }[],
  queries: [] as { where: unknown; order: unknown[]; limit: number }[],
}));

vi.mock("@/lib/app-url", () => ({ appUrl: state.appUrl }));
vi.mock("@/lib/digest/select", () => ({ selectDigestOpportunities: state.select }));

import { isDigestDue } from "@/lib/digest/schedule";

// An indivisible row-update model exercises the real claim/mark/release SQL.
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (where: unknown) => ({
          limit: async () => {
            const params = toSql(where).params;
            const ws = state.workspaces.find((row) => row.id === params[0]);
            return ws && ws.digestLeaseToken === params[1] && ws.digestLeaseUntil && ws.digestLeaseUntil > state.dbNow
              ? [{ id: ws.id }] : [];
          },
          orderBy: (...order: unknown[]) => ({
            limit: async (limit: number) => {
              state.queries.push({ where, order, limit });
              return state.workspaces
                .filter((ws) => ws.digestEnabled && !!ws.digestEmail?.trim()
                  && isDigestDue({ digestHourUtc: ws.digestHourUtc, lastSentAt: ws.digestLastSentAt, now: state.dbNow })
                  && (!ws.digestLeaseUntil || ws.digestLeaseUntil < state.dbNow))
                .sort((a, b) => (a.digestLastAttemptAt?.getTime() ?? -Infinity) - (b.digestLastAttemptAt?.getTime() ?? -Infinity) || a.id.localeCompare(b.id))
                .slice(0, limit)
                .map(({ id }) => ({ id }));
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: unknown) => {
          state.writes.push({ values, where });
          const params = toSql(where).params;
          const ws = state.workspaces.find((row) => row.id === params[0]);
          if (ws && values.digestLeaseToken === null && ws.digestLeaseToken === params[1]) {
            ws.digestLeaseToken = null;
            ws.digestLeaseUntil = null;
          }
          return Object.assign(Promise.resolve(), {
            returning: async () => {
              if (!ws) return [];
              if (typeof values.digestLeaseToken === "string") {
                if (!ws.digestEnabled || !ws.digestEmail?.trim()
                  || !isDigestDue({ digestHourUtc: ws.digestHourUtc, lastSentAt: ws.digestLastSentAt, now: state.dbNow })
                  || (ws.digestLeaseUntil && ws.digestLeaseUntil >= state.dbNow)) return [];
                ws.digestLeaseToken = values.digestLeaseToken;
                ws.digestLeaseUntil = new Date(state.dbNow.getTime() + 120_000);
                ws.digestLastAttemptAt = new Date(state.dbNow);
                return [{ ...ws }];
              }
              if (values.digestLastSentAt instanceof Date) {
                if (ws.digestLeaseToken !== params[1] || !ws.digestLeaseUntil || ws.digestLeaseUntil <= state.dbNow) return [];
                await state.record(ws.id, values.digestLastSentAt);
                if (ws.digestLeaseToken !== params[1]) return [];
                ws.digestLastSentAt = values.digestLastSentAt;
                return [{ id: ws.id }];
              }
              return [];
            },
          });
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/digest/send", async (importOriginal) => ({
  ...(await importOriginal<typeof DigestSendModule>()),
  sendDigestEmail: state.send,
}));

import { runDueDigests } from "@/lib/digest/dispatch";
import { markDigestSent } from "@/lib/digest/send";

const dialect = new PgDialect();
const toSql = (value: unknown) => dialect.sqlToQuery(value as Parameters<PgDialect["sqlToQuery"]>[0]);
const now = new Date("2026-10-10T13:00:00.000Z");
const opportunities: DigestOpportunity[] = [{
  opportunityId: "opportunity-1",
  score: 91,
  reason: "Looking for an alternative",
  platform: "reddit",
  title: "Which tool should I use?",
  url: "https://example.com/conversation",
}];

function workspace(id: string, overrides: Partial<DigestWorkspace> = {}): DigestWorkspace {
  return {
    id,
    digestEnabled: true,
    digestEmail: `${id}@example.com`,
    digestHourUtc: 13,
    digestLastSentAt: null,
    digestLeaseToken: null,
    digestLeaseUntil: null,
    digestLastAttemptAt: null,
    ...overrides,
  };
}

const deliveryKeys = () => state.fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));

beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  state.appUrl.mockReset().mockReturnValue("https://app.example.com");
  state.workspaces = [];
  state.writes = [];
  state.queries = [];
  state.dbNow = new Date(now);
  state.select.mockReset().mockResolvedValue(opportunities);
  state.record.mockReset().mockResolvedValue(undefined);
  state.fetch.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
  const actual = await vi.importActual<typeof DigestSendModule>("@/lib/digest/send");
  state.send.mockReset().mockImplementation((input) => actual.sendDigestEmail({ ...input, apiKey: "re_test" }));
  vi.stubGlobal("fetch", state.fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runDueDigests", () => {
  it("returns an empty summary when no workspaces enable digests", async () => {
    await expect(runDueDigests(now)).resolves.toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0, hasMore: false });
    expect(state.select).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("skips an unconfigured provider without resolving an unavailable app origin", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    state.appUrl.mockImplementation(() => { throw new Error("origin unavailable"); });
    state.workspaces = [workspace("unconfigured")];
    await expect(runDueDigests(now)).resolves.toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(state.appUrl).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("filters missing recipients and delivered slots before the batch limit", async () => {
    state.workspaces = [
      workspace("no-recipient", { digestEmail: null }),
      workspace("recent", { digestLastSentAt: new Date("2026-10-09T18:00:00.000Z") }),
      workspace("later", { digestHourUtc: 14, digestLastSentAt: new Date("2026-10-09T14:00:00.000Z") }),
    ];
    await expect(runDueDigests(now)).resolves.toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0, hasMore: false });
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(state.writes).toHaveLength(0);
    state.workspaces.unshift(...Array.from({ length: 30 }, (_, index) => workspace(`not-due-${index}`, {
      digestLastSentAt: now,
    })));
    state.workspaces.push(workspace("due"));
    expect((await runDueDigests(now)).sent).toBe(1);
    expect(state.fetch).toHaveBeenCalledOnce();
  });

  it("does not mark an empty digest", async () => {
    state.workspaces = [workspace("empty")];
    state.select.mockResolvedValue([]);
    await expect(runDueDigests(now)).resolves.toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0, hasMore: false });
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("does not contact the provider after ownership expires during selection", async () => {
    state.workspaces = [workspace("expired")];
    state.select.mockImplementationOnce(async () => {
      state.dbNow = new Date(now.getTime() + 121_000);
      return opportunities;
    });
    expect((await runDueDigests(now)).failed).toBe(1);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("atomically excludes a concurrent dispatch before provider delivery", async () => {
    state.workspaces = [workspace("concurrent")];
    let finish!: (response: Response) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    state.fetch.mockImplementationOnce(() => {
      started();
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const first = runDueDigests(now);
    const second = runDueDigests(now);
    await sending;
    expect(state.record).not.toHaveBeenCalled();
    const secondSummary = await second;
    expect(secondSummary.sent).toBe(0);
    expect(state.fetch).toHaveBeenCalledOnce();
    finish(new Response(null, { status: 200 }));
    expect((await first).sent).toBe(1);
    expect(state.workspaces[0]?.digestLastSentAt).toEqual(now);
    const claim = state.writes.find((write) => typeof write.values.digestLeaseToken === "string")!;
    expect(toSql(claim.where).sql).toMatch(/digest_lease_until.*is null.*or.*digest_lease_until.*< now\(\)/);
  });

  it("does not redeliver after failed marking and starts a new provider cycle only after a successful mark", async () => {
    state.workspaces = [workspace("retry")];
    const delivered = new Map<string, string>();
    state.fetch.mockImplementation(async (_url, init) => {
      const key = new Headers(init?.headers).get("Idempotency-Key")!;
      const body = String(init?.body);
      if (delivered.has(key) && delivered.get(key) !== body) return new Response(null, { status: 409 });
      delivered.set(key, body);
      return new Response(null, { status: 200 });
    });
    state.record.mockRejectedValueOnce(new Error("private database payload"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await runDueDigests(now)).failed).toBe(1);
    expect(state.workspaces[0]?.digestLastSentAt).toBeNull();
    expect((await runDueDigests(now)).sent).toBe(1);
    expect(delivered.size).toBe(1);
    const tomorrow = new Date("2026-10-11T13:00:00.000Z");
    state.dbNow = tomorrow;
    expect((await runDueDigests(tomorrow)).sent).toBe(1);
    expect(delivered.size).toBe(2);
    const keys = deliveryKeys();
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(state.workspaces[0]?.digestLastSentAt).toEqual(tomorrow);
  });

  it("keeps changed-payload idempotency conflicts failed without advancing last-sent", async () => {
    state.workspaces = [workspace("conflict")];
    state.record.mockRejectedValueOnce(new Error("recording failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runDueDigests(now);
    state.select.mockResolvedValue([{ ...opportunities[0]!, title: "Changed conversation" }]);
    state.fetch.mockResolvedValueOnce(new Response("private provider response", { status: 409 }));
    expect((await runDueDigests(now)).failed).toBe(1);
    expect(deliveryKeys()[1]).toBe(deliveryKeys()[0]);
    expect(state.workspaces[0]?.digestLastSentAt).toBeNull();
    expect(state.record).toHaveBeenCalledOnce();
  });

  it("does not let an expired sender mark or release a replacement claim", async () => {
    const row = workspace("stale");
    state.workspaces = [row];
    let finish!: (response: Response) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    state.fetch.mockImplementationOnce(() => {
      started();
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const dispatch = runDueDigests(now);
    await sending;
    const oldToken = row.digestLeaseToken!;
    state.dbNow = new Date(now.getTime() + 121_000);
    await expect(markDigestSent(row.id, now, oldToken)).resolves.toBe(false);
    row.digestLeaseToken = "replacement";
    row.digestLeaseUntil = new Date(state.dbNow.getTime() + 120_000);
    finish(new Response(null, { status: 200 }));
    expect((await dispatch).failed).toBe(1);
    expect(row.digestLastSentAt).toBeNull();
    expect(row.digestLeaseToken).toBe("replacement");
    const mark = state.writes.find((write) => write.values.digestLastSentAt)!;
    expect(toSql(mark.where).sql).toMatch(/digest_lease_token.*=.*digest_lease_until.*> now\(\)/);
  });

  it("rotates a capped batch past empty early workspaces on the next invocation", async () => {
    state.workspaces = Array.from({ length: 30 }, (_, index) => workspace(`ws-${String(index).padStart(2, "0")}`));
    state.select.mockImplementation(async (id) => id === "ws-29" ? opportunities : []);
    const first = await runDueDigests(now);
    expect(first.checked).toBe(25);
    expect(first.hasMore).toBe(true);
    expect(state.fetch).not.toHaveBeenCalled();
    expect((await runDueDigests(now)).sent).toBe(1);
    expect(state.workspaces[29]?.digestLastSentAt).toEqual(now);
    expect(state.queries.every((query) => query.limit === 26)).toBe(true);
    expect(toSql(state.queries[0]!.order[0]).sql).toMatch(/digest_last_attempt_at.*asc nulls first/);
  });

  it("stops starting work when the shared deadline cannot fit another operation", async () => {
    state.workspaces = [workspace("a"), workspace("b")];
    const clock = vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    state.select.mockImplementationOnce(async () => {
      clock.mockReturnValue(now.getTime() + 11_000);
      return [];
    });
    const summary = await runDueDigests(now);
    expect(summary.checked).toBe(1);
    expect(summary.hasMore).toBe(true);
    expect(state.workspaces[1]?.digestLastAttemptAt).toBeNull();
  });

  it.each(["selection", "recording", "sending"] as const)("isolates %s errors and logs no private payload or recipient", async (failure) => {
    state.workspaces = [workspace("broken"), workspace("healthy")];
    const secret = new Error("private connection or provider payload");
    if (failure === "selection") state.select.mockRejectedValueOnce(secret);
    if (failure === "recording") state.record.mockRejectedValueOnce(secret);
    if (failure === "sending") state.send.mockRejectedValueOnce(secret);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runDueDigests(now)).resolves.toEqual({ checked: 2, sent: 1, skipped: 0, failed: 1, hasMore: false });
    expect(state.workspaces[1]?.digestLastSentAt).toEqual(now);
    expect(state.workspaces.every((ws) => !ws.digestLeaseToken)).toBe(true);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/private connection or provider payload|@example\.com/);
    expect(state.record.mock.calls.some(([id]) => id === "broken")).toBe(failure === "recording");
  });
});
