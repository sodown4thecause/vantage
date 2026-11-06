import { beforeEach, describe, expect, it, vi } from "vitest";

import { signAssertion, verifyAssertion } from "@/lib/agent/assertion";
import {
  AGENT_TRIAL_MAX_PER_DAY,
  AGENT_TRIAL_MAX_PER_IP_PER_DAY,
} from "@/lib/agent/config";
import { hashSecret } from "@/lib/agent/crypto";
import type { AgentStore, AuditEntry, OAuthClientRecord } from "@/lib/agent/oauth/store";
import {
  completeClaim,
  createAnonymousRegistration,
  exchangeClaimGrant,
  exchangeAssertion,
  initiateClaim,
  type ClaimAttemptRecord,
  type RegistrationRecord,
  type RegistrationStore,
} from "@/lib/agent/registration";

const ORIGIN = "https://staging.example.com";
const KEY = "test-assertion-key";
const PEPPER = "test-pepper";
const NOW = new Date("2026-11-06T00:00:00Z");

type FakeRegistration = RegistrationRecord & {
  claimTokenHash: string;
  createdAt: Date;
  toolCalls: number;
  draftAttempts: number;
};

function createFakeRegistrationStore() {
  const registrations = new Map<string, FakeRegistration>();
  const attempts = new Map<string, ClaimAttemptRecord>();
  const workspaces: string[] = [];
  const owned = new Set<string>();
  const slots = new Map<string, number>();
  let sequence = 0;

  const store: RegistrationStore & {
    registrations: typeof registrations;
    attempts: typeof attempts;
    workspaces: typeof workspaces;
    owned: typeof owned;
    slots: typeof slots;
  } = {
    registrations,
    attempts,
    workspaces,
    owned,
    slots,
    async reserveRegistrationSlot(input) {
      // Mirrors the SQL: each cap increments only while under its limit.
      const ipKey = input.ipHash ? `${input.day}:ip:${input.ipHash}` : null;
      const globalKey = `${input.day}:global`;
      if (ipKey && (slots.get(ipKey) ?? 0) >= input.maxPerIp) {
        return { ok: false, reason: "rate_limited" };
      }
      if ((slots.get(globalKey) ?? 0) >= input.maxPerDay) {
        return { ok: false, reason: "quota_exceeded" };
      }
      if (ipKey) slots.set(ipKey, (slots.get(ipKey) ?? 0) + 1);
      slots.set(globalKey, (slots.get(globalKey) ?? 0) + 1);
      return { ok: true };
    },
    async createTrialRegistration(input) {
      sequence += 1;
      const id = `reg_${sequence}`;
      const workspaceId = `ws_${sequence}`;
      workspaces.push(workspaceId);
      registrations.set(id, {
        id,
        status: "active",
        workspaceId,
        expiresAt: input.expiresAt,
        claimTokenExpiresAt: input.claimTokenExpiresAt,
        claimTokenHash: input.claimTokenHash,
        createdAt: NOW,
        toolCalls: 0,
        draftAttempts: 0,
        ...({ ipHash: input.ipHash } as object),
      } as FakeRegistration);
      return { id, workspaceId };
    },
    async findRegistration(id) {
      return registrations.get(id) ?? null;
    },
    async findRegistrationByClaimTokenHash(hash) {
      return [...registrations.values()].find((row) => row.claimTokenHash === hash) ?? null;
    },
    async createClaimAttempt(input) {
      sequence += 1;
      const id = `cla_${sequence}`;
      attempts.set(id, { id, status: "pending", attempts: 0, ...input });
      return { id };
    },
    async expireRegistrations(now) {
      let expired = 0;
      for (const row of registrations.values()) {
        if (row.status === "active" && row.expiresAt <= now) {
          row.status = "expired";
          expired += 1;
        }
      }
      // Mirrors the SQL: delete by status, so a delete that failed on an
      // earlier run is retried rather than leaking the workspace.
      // Only unowned workspaces are deleted, mirroring the SQL guard.
      const doomed = new Set(
        [...registrations.values()]
          .filter((row) => row.status === "expired" && row.workspaceId && !owned.has(row.workspaceId))
          .map((row) => row.workspaceId!),
      );
      for (const workspaceId of doomed) {
        const index = workspaces.indexOf(workspaceId);
        if (index >= 0) workspaces.splice(index, 1);
      }
      return { expired, workspacesDeleted: doomed.size };
    },
    async consumeToolCall(id, workspaceId, limit, now) {
      const row = registrations.get(id);
      if (!row || row.workspaceId !== workspaceId) return false;
      // A claimed workspace is on the user's plan, so trial quotas stop applying.
      if (row.status === "claimed") return true;
      if (row.status !== "active" || row.expiresAt <= now || row.toolCalls >= limit) return false;
      row.toolCalls += 1;
      return true;
    },
    async consumeDraftAttempt(id, workspaceId, limit, now) {
      const row = registrations.get(id);
      if (!row || row.workspaceId !== workspaceId) return false;
      if (row.status === "claimed") return true;
      if (row.status !== "active" || row.expiresAt <= now || row.draftAttempts >= limit) return false;
      row.draftAttempts += 1;
      return true;
    },
    async findClaimAttempt(id) {
      return attempts.get(id) ?? null;
    },
    async reserveClaimAttempt(id, maxAttempts, now) {
      const attempt = attempts.get(id);
      if (!attempt) return false;
      if (attempt.status !== "pending" || attempt.expiresAt <= now) return false;
      if (attempt.attempts >= maxAttempts) return false;
      attempt.attempts += 1;
      return true;
    },
    async completeClaim(input) {
      const registration = registrations.get(input.registrationId);
      if (!registration || registration.status !== "active") return false;
      // Mirrors the SQL guard: one workspace per user.
      const alreadyOwned = [...registrations.values()].some(
        (row) => row.status === "claimed" && row.id !== input.registrationId,
      );
      if (alreadyOwned) return false;
      registration.status = "claimed";
      if (registration.workspaceId) owned.add(registration.workspaceId);
      const attempt = attempts.get(input.attemptId);
      if (attempt) attempt.status = "completed";
      return true;
    },
  };
  return store;
}

function createFakeAgentStore() {
  const tokens = new Map<string, Record<string, unknown>>();
  const audits: AuditEntry[] = [];
  const clients = new Map<string, OAuthClientRecord>();
  let sequence = 0;
  const store: AgentStore & { tokens: typeof tokens; audits: typeof audits } = {
    tokens,
    audits,
    async getClient(id) {
      return clients.get(id) ?? null;
    },
    async createClient(input) {
      clients.set(input.id, input);
    },
    async createAuthorizationCode() {},
    async consumeAuthorizationCode() {
      return null;
    },
    async createToken(input) {
      sequence += 1;
      tokens.set(input.tokenHash, { ...input, id: `tok_${sequence}`, revokedAt: null });
    },
    async findToken(hash) {
      return (tokens.get(hash) as never) ?? null;
    },
    async revokeToken() {
      return false;
    },
    async revokeTokenFamily() {
      return 0;
    },
    async audit(entry) {
      audits.push(entry);
    },
  };
  return store;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("identity assertions", () => {
  const payload = {
    iss: ORIGIN,
    sub: "reg_1",
    aud: `${ORIGIN}/`,
    iat: Math.floor(NOW.getTime() / 1_000),
    exp: Math.floor(NOW.getTime() / 1_000) + 900,
    jti: "jti_1",
    scope: "vantage.read",
    typ: "agent_identity" as const,
  };

  it("round-trips a signed assertion", async () => {
    const token = await signAssertion(payload, KEY);
    const verified = await verifyAssertion(token, KEY, {
      issuer: ORIGIN,
      audience: `${ORIGIN}/`,
      now: NOW,
    });
    expect(verified?.sub).toBe("reg_1");
  });

  it("rejects a wrong secret, audience, type or expiry", async () => {
    const token = await signAssertion(payload, KEY);
    const opts = { issuer: ORIGIN, audience: `${ORIGIN}/`, now: NOW };
    expect(await verifyAssertion(token, "other-key", opts)).toBeNull();
    expect(await verifyAssertion(token, KEY, { ...opts, audience: "https://elsewhere/" })).toBeNull();
    expect(await verifyAssertion(token, KEY, { ...opts, issuer: "https://elsewhere" })).toBeNull();
    expect(await verifyAssertion(token, KEY, { ...opts, now: new Date("2026-11-06T01:00:00Z") })).toBeNull();
    expect(await verifyAssertion("not.a.token", KEY, opts)).toBeNull();

    const wrongType = await signAssertion({ ...payload, typ: "other" as never }, KEY);
    expect(await verifyAssertion(wrongType, KEY, opts)).toBeNull();
  });
});

describe("anonymous registration", () => {
  it("creates a trial workspace, a registration and a usable assertion", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.workspaces).toHaveLength(1);
    expect(result.claimToken).toMatch(/^clm_/);
    expect(result.claimTokenExpires.getTime() - NOW.getTime()).toBe(7 * 86_400_000);

    const verified = await verifyAssertion(result.assertion, KEY, {
      issuer: ORIGIN,
      audience: `${ORIGIN}/`,
      now: NOW,
    });
    expect(verified?.sub).toBe(result.registrationId);
    expect(verified?.scope).toBe("vantage.read");
  });

  it("caps registrations per address and overall", async () => {
    const store = createFakeRegistrationStore();
    const register = () =>
      createAnonymousRegistration({
        store,
        origin: ORIGIN,
        signingKey: KEY,
        keyId: "vantage-agent-1",
        pepper: PEPPER,
        ipHash: "ip_hash_1",
        now: NOW,
      });

    for (let index = 0; index < AGENT_TRIAL_MAX_PER_IP_PER_DAY; index += 1) {
      expect((await register()).ok).toBe(true);
    }
    const blocked = await register();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("rate_limited");

    // A different address still gets through until the global cap.
    const other = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_2",
      now: NOW,
    });
    expect(other.ok).toBe(true);
    expect(AGENT_TRIAL_MAX_PER_DAY).toBeGreaterThan(AGENT_TRIAL_MAX_PER_IP_PER_DAY);
  });

  it("reserves slots atomically, so concurrent requests cannot overspend", async () => {
    const store = createFakeRegistrationStore();
    const register = () =>
      createAnonymousRegistration({
        store,
        origin: ORIGIN,
        signingKey: KEY,
        keyId: "vantage-agent-1",
        pepper: PEPPER,
        ipHash: "ip_hash_1",
        now: NOW,
      });

    // Ten concurrent requests against a cap of three: exactly three succeed.
    const results = await Promise.all(Array.from({ length: 10 }, register));
    expect(results.filter((result) => result.ok)).toHaveLength(AGENT_TRIAL_MAX_PER_IP_PER_DAY);
    expect(results.filter((result) => !result.ok && result.error === "rate_limited")).toHaveLength(
      10 - AGENT_TRIAL_MAX_PER_IP_PER_DAY,
    );
    // And only three trial workspaces exist.
    expect(store.workspaces).toHaveLength(AGENT_TRIAL_MAX_PER_IP_PER_DAY);
  });

  it("creates the workspace and the registration together", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");
    // Every workspace has a registration pointing at it, so cleanup can find it.
    const registered = new Set(
      [...store.registrations.values()].map((row) => row.workspaceId),
    );
    for (const workspaceId of store.workspaces) expect(registered.has(workspaceId)).toBe(true);
  });
});

describe("claim initiation", () => {
  async function registered() {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");
    return { store, result };
  }

  it("returns a six-digit code and a link that identifies the attempt", async () => {
    const { store, result } = await registered();
    const claim = await initiateClaim({
      store,
      claimToken: result.claimToken,
      email: "human@example.com",
      pepper: PEPPER,
      origin: ORIGIN,
      now: NOW,
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.userCode).toMatch(/^\d{6}$/);
    expect(claim.verificationUri).toBe(`${ORIGIN}/auth-agents/claim?attempt=${claim.attemptId}`);
    expect([...store.attempts.values()][0]?.email).toBe("human@example.com");
    // The code is stored hashed, never raw.
    expect([...store.attempts.values()][0]?.userCodeHash).not.toBe(claim.userCode);
  });

  it("refuses an unknown, claimed or expired registration", async () => {
    const { store, result } = await registered();
    const base = { store, email: null, pepper: PEPPER, origin: ORIGIN, now: NOW };

    const unknown = await initiateClaim({ ...base, claimToken: "clm_nope" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBe("invalid_claim_token");

    const expired = await initiateClaim({ ...base, claimToken: result.claimToken, now: new Date("2026-11-20T00:00:00Z") });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error).toBe("claim_expired");

    const row = store.registrations.get(result.registrationId)!;
    row.status = "claimed";
    const claimed = await initiateClaim({ ...base, claimToken: result.claimToken });
    expect(claimed.ok).toBe(false);
    if (!claimed.ok) expect(claimed.error).toBe("claimed_or_in_flight");
  });
});

describe("assertion exchange", () => {
  async function registered() {
    const registrations = createFakeRegistrationStore();
    const agents = createFakeAgentStore();
    const result = await createAnonymousRegistration({
      store: registrations,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");
    return { registrations, agents, result };
  }

  it("issues a read-only token bound to the trial workspace", async () => {
    const { registrations, agents, result } = await registered();
    const outcome = await exchangeAssertion({
      store: { ...registrations, ...agents },
      assertion: result.assertion,
      signingKey: KEY,
      origin: ORIGIN,
      pepper: PEPPER,
      clientId: null,
      now: NOW,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.body.scope).toBe("vantage.read");

    const stored = [...agents.tokens.values()][0] as {
      registrationId: string;
      workspaceId: string;
      clientId: string | null;
    };
    expect(stored.registrationId).toBe(result.registrationId);
    expect(stored.workspaceId).toBe(registrations.workspaces[0]);
    expect(stored.clientId).toBeNull();
  });

  it("refuses a forged assertion and an expired registration", async () => {
    const { registrations, agents, result } = await registered();
    const base = {
      store: { ...registrations, ...agents },
      signingKey: KEY,
      origin: ORIGIN,
      pepper: PEPPER,
      clientId: null,
      now: NOW,
    };

    const forged = await exchangeAssertion({ ...base, assertion: `${result.assertion}x` });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.body.error).toBe("invalid_grant");

    const expired = await exchangeAssertion({
      ...base,
      assertion: result.assertion,
      now: new Date("2026-11-20T00:00:00Z"),
    });
    expect(expired.ok).toBe(false);
  });
});

describe("trial quotas", () => {
  it("stops counting once the limit is reached", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");

    const workspaceId = store.registrations.get(result.registrationId)!.workspaceId!;
    expect(await store.consumeToolCall(result.registrationId, workspaceId, 2, NOW)).toBe(true);
    expect(await store.consumeToolCall(result.registrationId, workspaceId, 2, NOW)).toBe(true);
    expect(await store.consumeToolCall(result.registrationId, workspaceId, 2, NOW)).toBe(false);
    expect(await store.consumeDraftAttempt(result.registrationId, workspaceId, 1, NOW)).toBe(true);
    expect(await store.consumeDraftAttempt(result.registrationId, workspaceId, 1, NOW)).toBe(false);
  });

  it("refuses a quota write for a different workspace", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");

    // The counter is scoped by workspace, so a mismatched id changes nothing.
    expect(await store.consumeToolCall(result.registrationId, "ws_other", 100, NOW)).toBe(false);
    expect(await store.consumeDraftAttempt(result.registrationId, "ws_other", 100, NOW)).toBe(false);
  });

  it("expires a trial and reports the workspace it removed", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");

    const cleanup = await store.expireRegistrations(new Date("2026-11-20T00:00:00Z"));
    expect(cleanup).toEqual({ expired: 1, workspacesDeleted: 1 });
    expect(store.registrations.get(result.registrationId)?.status).toBe("expired");
  });

  it("never deletes a workspace a human owns, even if its registration is still active", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");
    // Simulate a transfer that set ownership but failed before marking the
    // registration claimed: cleanup must not delete the human's workspace.
    store.owned.add(store.workspaces[0]!);

    const cleanup = await store.expireRegistrations(new Date("2026-11-20T00:00:00Z"));
    expect(cleanup).toEqual({ expired: 1, workspacesDeleted: 0 });
  });

  it("retries a workspace whose delete failed on an earlier run", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");

    // Simulate the earlier run: the registration is already expired but its
    // workspace survived, because the delete failed after the status update.
    store.registrations.get(result.registrationId)!.status = "expired";
    expect(store.workspaces).toHaveLength(1);

    const cleanup = await store.expireRegistrations(new Date("2026-11-20T00:00:00Z"));
    // Nothing new expired, but the leaked workspace is still found and removed.
    expect(cleanup).toEqual({ expired: 0, workspacesDeleted: 1 });
  });

  it("stops applying trial quotas once the workspace is claimed", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");
    const workspaceId = store.registrations.get(result.registrationId)!.workspaceId!;
    store.registrations.get(result.registrationId)!.status = "claimed";
    expect(await store.consumeToolCall(result.registrationId, workspaceId, 0, NOW)).toBe(true);
    expect(await store.consumeDraftAttempt(result.registrationId, workspaceId, 0, NOW)).toBe(true);
  });
});

describe("claim token hashing", () => {
  it("never stores the raw claim token", async () => {
    const store = createFakeRegistrationStore();
    const result = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: null,
      now: NOW,
    });
    if (!result.ok) throw new Error("registration failed");
    const row = store.registrations.get(result.registrationId)!;
    expect(row.claimTokenHash).toBe(await hashSecret(result.claimToken, PEPPER));
    expect(row.claimTokenHash).not.toContain(result.claimToken);
  });
});

describe("claim completion", () => {
  async function ceremony(email: string | null = null) {
    const store = createFakeRegistrationStore();
    const registration = await createAnonymousRegistration({
      store,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!registration.ok) throw new Error("registration failed");
    const claim = await initiateClaim({
      store,
      claimToken: registration.claimToken,
      email,
      pepper: PEPPER,
      origin: ORIGIN,
      now: NOW,
    });
    if (!claim.ok) throw new Error("claim failed");
    return { store, registration, claim };
  }

  const complete = (
    store: ReturnType<typeof createFakeRegistrationStore>,
    attemptId: string,
    userCode: string,
    overrides: Partial<{ userEmail: string | null; now: Date }> = {},
  ) =>
    completeClaim({
      store,
      attemptId,
      userCode,
      userId: "user_1",
      userEmail: "human@example.com",
      plan: "free",
      pepper: PEPPER,
      now: NOW,
      ...overrides,
    });

  it("binds the workspace to the user and marks the registration claimed", async () => {
    const { store, claim } = await ceremony();
    const result = await complete(store, claim.attemptId, claim.userCode);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workspaceId).toBe(store.workspaces[0]);
    expect(store.registrations.get(claim.registrationId)?.status).toBe("claimed");
    expect(store.attempts.get(claim.attemptId)?.status).toBe("completed");
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { store, claim } = await ceremony();
    const wrong = claim.userCode === "000000" ? "111111" : "000000";
    const result = await complete(store, claim.attemptId, wrong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_code");
    expect(store.attempts.get(claim.attemptId)?.attempts).toBe(1);
    expect(store.registrations.get(claim.registrationId)?.status).toBe("active");
  });

  it("stops after five wrong codes", async () => {
    const { store, claim } = await ceremony();
    const wrong = claim.userCode === "000000" ? "111111" : "000000";
    for (let index = 0; index < 5; index += 1) await complete(store, claim.attemptId, wrong);
    const result = await complete(store, claim.attemptId, claim.userCode);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("too_many_attempts");
  });

  it("reserves a guess before comparing, so parallel submissions cannot overspend", async () => {
    const { store, claim } = await ceremony();
    const wrong = claim.userCode === "000000" ? "111111" : "000000";
    // Five concurrent submissions: exactly five guesses are reserved, so the
    // sixth (even with the right code) is refused.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => complete(store, claim.attemptId, wrong)),
    );
    expect(results.filter((result) => !result.ok && result.error === "invalid_code")).toHaveLength(5);
    expect(results.filter((result) => !result.ok && result.error === "too_many_attempts")).toHaveLength(1);
    expect(store.attempts.get(claim.attemptId)?.attempts).toBe(5);
  });

  it("rejects an expired code", async () => {
    const { store, claim } = await ceremony();
    const result = await complete(store, claim.attemptId, claim.userCode, {
      now: new Date("2026-11-06T01:00:00Z"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("expired");
  });

  it("rejects a different signed-in email when the agent named one", async () => {
    const { store, claim } = await ceremony("human@example.com");
    const result = await complete(store, claim.attemptId, claim.userCode, {
      userEmail: "someone.else@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("email_mismatch");
  });

  it("refuses a second claim of the same workspace", async () => {
    const { store, claim } = await ceremony();
    expect((await complete(store, claim.attemptId, claim.userCode)).ok).toBe(true);
    const again = await complete(store, claim.attemptId, claim.userCode);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("already_claimed");
  });

  it("refuses a second trial for the same account", async () => {
    // One store, two trials, one account: the guard lives in the transfer, not
    // only in the page, so the second claim must fail.
    const store = createFakeRegistrationStore();
    const start = async () => {
      const registration = await createAnonymousRegistration({
        store,
        origin: ORIGIN,
        signingKey: KEY,
        keyId: "vantage-agent-1",
        pepper: PEPPER,
        ipHash: "ip_hash_1",
        now: NOW,
      });
      if (!registration.ok) throw new Error("registration failed");
      const claim = await initiateClaim({
        store,
        claimToken: registration.claimToken,
        email: null,
        pepper: PEPPER,
        origin: ORIGIN,
        now: NOW,
      });
      if (!claim.ok) throw new Error("claim failed");
      return claim;
    };

    const first = await start();
    expect((await complete(store, first.attemptId, first.userCode)).ok).toBe(true);

    const second = await start();
    const result = await complete(store, second.attemptId, second.userCode);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("already_claimed");
  });
});

describe("claim grant polling", () => {
  async function ceremony() {
    const registrations = createFakeRegistrationStore();
    const agents = createFakeAgentStore();
    const registration = await createAnonymousRegistration({
      store: registrations,
      origin: ORIGIN,
      signingKey: KEY,
      keyId: "vantage-agent-1",
      pepper: PEPPER,
      ipHash: "ip_hash_1",
      now: NOW,
    });
    if (!registration.ok) throw new Error("registration failed");
    const claim = await initiateClaim({
      store: registrations,
      claimToken: registration.claimToken,
      email: null,
      pepper: PEPPER,
      origin: ORIGIN,
      now: NOW,
    });
    if (!claim.ok) throw new Error("claim failed");
    return { registrations, agents, registration, claim };
  }

  it("reports authorization_pending until a human finishes", async () => {
    const { registrations, agents, registration } = await ceremony();
    const outcome = await exchangeClaimGrant({
      store: { ...registrations, ...agents },
      claimToken: registration.claimToken,
      pepper: PEPPER,
      now: NOW,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.body.error).toBe("authorization_pending");
  });

  it("issues a read-and-draft token once claimed", async () => {
    const { registrations, agents, registration, claim } = await ceremony();
    await completeClaim({
      store: registrations,
      attemptId: claim.attemptId,
      userCode: claim.userCode,
      userId: "user_1",
      userEmail: null,
      plan: "free",
      pepper: PEPPER,
      now: NOW,
    });
    const outcome = await exchangeClaimGrant({
      store: { ...registrations, ...agents },
      claimToken: registration.claimToken,
      pepper: PEPPER,
      now: NOW,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.body.scope).toBe("vantage.read vantage.draft");
  });

  it("reports expired_token for a registration that lapsed", async () => {
    const { registrations, agents, registration } = await ceremony();
    const row = registrations.registrations.get(registration.registrationId)!;
    row.status = "expired";
    const outcome = await exchangeClaimGrant({
      store: { ...registrations, ...agents },
      claimToken: registration.claimToken,
      pepper: PEPPER,
      now: NOW,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.body.error).toBe("expired_token");
  });

  it("refuses a claim token past its own expiry, even after the claim", async () => {
    const { registrations, agents, registration, claim } = await ceremony();
    await completeClaim({
      store: registrations,
      attemptId: claim.attemptId,
      userCode: claim.userCode,
      userId: "user_1",
      userEmail: null,
      plan: "free",
      pepper: PEPPER,
      now: NOW,
    });
    // Cleanup never expires a claimed registration, so the claim token's own
    // expiry is the only thing that stops it minting tokens forever.
    const outcome = await exchangeClaimGrant({
      store: { ...registrations, ...agents },
      claimToken: registration.claimToken,
      pepper: PEPPER,
      now: new Date("2026-11-20T00:00:00Z"),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.body.error).toBe("expired_token");
  });
});
