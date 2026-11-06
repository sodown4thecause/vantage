import { and, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import { signAssertion, verifyAssertion } from "@/lib/agent/assertion";
import {
  AGENT_ASSERTION_TTL_SECONDS,
  AGENT_POST_CLAIM_SCOPES,
  AGENT_PRE_CLAIM_SCOPES,
  AGENT_TRIAL_DAYS,
  AGENT_TRIAL_MAX_PER_DAY,
  AGENT_TRIAL_MAX_PER_IP_PER_DAY,
  AGENT_USER_CODE_TTL_SECONDS,
  parseScopes,
} from "@/lib/agent/config";
import { hashSecret, randomToken, randomUserCode } from "@/lib/agent/crypto";
import { issueTokensFor, type TokenResult } from "@/lib/agent/oauth/flow";
import type { AgentStore } from "@/lib/agent/oauth/store";
import { getDb } from "@/lib/db/client";
import { agentClaimAttempt, agentRegistration, workspace } from "@/lib/db/schema";

export type RegistrationRecord = {
  id: string;
  status: "active" | "claimed" | "expired" | "revoked";
  workspaceId: string | null;
  expiresAt: Date;
  claimTokenExpiresAt: Date;
};

export type RegistrationStore = {
  countRegistrationsSince(since: Date, ipHash: string | null): Promise<number>;
  createTrialWorkspace(name: string): Promise<string>;
  createRegistration(input: {
    workspaceId: string;
    claimTokenHash: string;
    claimTokenExpiresAt: Date;
    assertionKeyId: string;
    expiresAt: Date;
    ipHash: string | null;
  }): Promise<{ id: string }>;
  findRegistration(id: string): Promise<RegistrationRecord | null>;
  findRegistrationByClaimTokenHash(hash: string): Promise<RegistrationRecord | null>;
  createClaimAttempt(input: {
    registrationId: string;
    userCodeHash: string;
    email: string | null;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  /** Marks expired trials and deletes their workspaces. Returns what it touched. */
  expireRegistrations(now: Date): Promise<{ expired: number; workspacesDeleted: number }>;
  /** Atomic quota check: increments only while under the limit and still active. */
  consumeToolCall(registrationId: string, limit: number, now: Date): Promise<boolean>;
  consumeDraftAttempt(registrationId: string, limit: number, now: Date): Promise<boolean>;
};

function toRecord(row: typeof agentRegistration.$inferSelect): RegistrationRecord {
  return {
    id: row.id,
    status: row.status,
    workspaceId: row.workspaceId,
    expiresAt: row.expiresAt,
    claimTokenExpiresAt: row.claimTokenExpiresAt,
  };
}

export function drizzleRegistrationStore(): RegistrationStore {
  return {
    async countRegistrationsSince(since, ipHash) {
      const [row] = await getDb()
        .select({ count: sql<number>`count(*)::int` })
        .from(agentRegistration)
        .where(
          and(
            gte(agentRegistration.createdAt, since),
            ipHash ? eq(agentRegistration.ipHash, ipHash) : undefined,
          ),
        );
      return row?.count ?? 0;
    },

    async createTrialWorkspace(name) {
      const [row] = await getDb()
        .insert(workspace)
        .values({ name, plan: "agent_trial", ownerUserId: null })
        .returning({ id: workspace.id });
      return row!.id;
    },

    async createRegistration(input) {
      const [row] = await getDb()
        .insert(agentRegistration)
        .values({
          type: "anonymous",
          status: "active",
          workspaceId: input.workspaceId,
          claimTokenHash: input.claimTokenHash,
          claimTokenExpiresAt: input.claimTokenExpiresAt,
          assertionKeyId: input.assertionKeyId,
          expiresAt: input.expiresAt,
          ipHash: input.ipHash,
        })
        .returning({ id: agentRegistration.id });
      return { id: row!.id };
    },

    async findRegistration(id) {
      const [row] = await getDb()
        .select()
        .from(agentRegistration)
        .where(eq(agentRegistration.id, id))
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async findRegistrationByClaimTokenHash(hash) {
      const [row] = await getDb()
        .select()
        .from(agentRegistration)
        .where(eq(agentRegistration.claimTokenHash, hash))
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async createClaimAttempt(input) {
      const [row] = await getDb()
        .insert(agentClaimAttempt)
        .values({
          registrationId: input.registrationId,
          userCodeHash: input.userCodeHash,
          email: input.email,
          expiresAt: input.expiresAt,
        })
        .returning({ id: agentClaimAttempt.id });
      return { id: row!.id };
    },

    async expireRegistrations(now) {
      const expired = await getDb()
        .update(agentRegistration)
        .set({ status: "expired" })
        .where(and(eq(agentRegistration.status, "active"), lte(agentRegistration.expiresAt, now)))
        .returning({ workspaceId: agentRegistration.workspaceId });
      const workspaceIds = expired
        .map((row) => row.workspaceId)
        .filter((id): id is string => typeof id === "string");
      if (workspaceIds.length > 0) {
        await getDb().delete(workspace).where(inArray(workspace.id, workspaceIds));
      }
      await getDb()
        .update(agentClaimAttempt)
        .set({ status: "expired" })
        .where(and(eq(agentClaimAttempt.status, "pending"), lte(agentClaimAttempt.expiresAt, now)));
      return { expired: expired.length, workspacesDeleted: workspaceIds.length };
    },

    async consumeToolCall(registrationId, limit, now) {
      const rows = await getDb()
        .update(agentRegistration)
        .set({ toolCalls: sql`${agentRegistration.toolCalls} + 1` })
        .where(
          and(
            eq(agentRegistration.id, registrationId),
            eq(agentRegistration.status, "active"),
            gt(agentRegistration.expiresAt, now),
            sql`${agentRegistration.toolCalls} < ${limit}`,
          ),
        )
        .returning({ id: agentRegistration.id });
      return rows.length > 0;
    },

    async consumeDraftAttempt(registrationId, limit, now) {
      const rows = await getDb()
        .update(agentRegistration)
        .set({ draftAttempts: sql`${agentRegistration.draftAttempts} + 1` })
        .where(
          and(
            eq(agentRegistration.id, registrationId),
            eq(agentRegistration.status, "active"),
            gt(agentRegistration.expiresAt, now),
            sql`${agentRegistration.draftAttempts} < ${limit}`,
          ),
        )
        .returning({ id: agentRegistration.id });
      return rows.length > 0;
    },
  };
}

export type AnonymousRegistration =
  | {
      ok: true;
      registrationId: string;
      assertion: string;
      assertionExpires: Date;
      claimToken: string;
      claimTokenExpires: Date;
    }
  | { ok: false; error: "rate_limited" | "quota_exceeded" };

/**
 * Creates a trial workspace and an anonymous registration. Two durable caps sit
 * behind the Cloudflare rate limiter: registrations per hashed IP per day, and
 * registrations overall per day.
 */
export async function createAnonymousRegistration(opts: {
  store: RegistrationStore;
  origin: string;
  signingKey: string;
  keyId: string;
  pepper: string;
  ipHash: string | null;
  now: Date;
}): Promise<AnonymousRegistration> {
  const dayStart = new Date(
    Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate()),
  );
  if (opts.ipHash) {
    const perIp = await opts.store.countRegistrationsSince(dayStart, opts.ipHash);
    if (perIp >= AGENT_TRIAL_MAX_PER_IP_PER_DAY) return { ok: false, error: "rate_limited" };
  }
  const overall = await opts.store.countRegistrationsSince(dayStart, null);
  if (overall >= AGENT_TRIAL_MAX_PER_DAY) return { ok: false, error: "quota_exceeded" };

  const workspaceId = await opts.store.createTrialWorkspace("Agent trial");
  const claimToken = randomToken("clm");
  const expiresAt = new Date(opts.now.getTime() + AGENT_TRIAL_DAYS * 86_400_000);
  const { id } = await opts.store.createRegistration({
    workspaceId,
    claimTokenHash: await hashSecret(claimToken, opts.pepper),
    claimTokenExpiresAt: expiresAt,
    assertionKeyId: opts.keyId,
    expiresAt,
    ipHash: opts.ipHash,
  });

  const assertionExpires = new Date(opts.now.getTime() + AGENT_ASSERTION_TTL_SECONDS * 1_000);
  const assertion = await signAssertion(
    {
      iss: opts.origin,
      sub: id,
      aud: `${opts.origin}/`,
      iat: Math.floor(opts.now.getTime() / 1_000),
      exp: Math.floor(assertionExpires.getTime() / 1_000),
      jti: crypto.randomUUID(),
      scope: AGENT_PRE_CLAIM_SCOPES.join(" "),
      typ: "agent_identity",
    },
    opts.signingKey,
  );

  return { ok: true, registrationId: id, assertion, assertionExpires, claimToken, claimTokenExpires: expiresAt };
}

export type ClaimInitiation =
  | {
      ok: true;
      registrationId: string;
      attemptId: string;
      userCode: string;
      expiresAt: Date;
      verificationUri: string;
    }
  | { ok: false; error: "invalid_claim_token" | "claimed_or_in_flight" | "claim_expired" };

/** Starts a claim ceremony: a 6-digit code plus a link that identifies the attempt. */
export async function initiateClaim(opts: {
  store: RegistrationStore;
  claimToken: string;
  email: string | null;
  pepper: string;
  origin: string;
  now: Date;
}): Promise<ClaimInitiation> {
  const registration = await opts.store.findRegistrationByClaimTokenHash(
    await hashSecret(opts.claimToken, opts.pepper),
  );
  if (!registration) return { ok: false, error: "invalid_claim_token" };
  if (registration.status !== "active") return { ok: false, error: "claimed_or_in_flight" };
  if (registration.expiresAt.getTime() <= opts.now.getTime()) return { ok: false, error: "claim_expired" };

  const userCode = randomUserCode();
  const expiresAt = new Date(opts.now.getTime() + AGENT_USER_CODE_TTL_SECONDS * 1_000);
  const { id } = await opts.store.createClaimAttempt({
    registrationId: registration.id,
    userCodeHash: await hashSecret(userCode, opts.pepper),
    email: opts.email,
    expiresAt,
  });
  return {
    ok: true,
    registrationId: registration.id,
    attemptId: id,
    userCode,
    expiresAt,
    verificationUri: `${opts.origin}/auth-agents/claim?attempt=${id}`,
  };
}

/** RFC 7523 jwt-bearer exchange: an anonymous assertion becomes an access token. */
export async function exchangeAssertion(opts: {
  store: RegistrationStore & AgentStore;
  assertion: string;
  signingKey: string;
  origin: string;
  pepper: string;
  clientId: string | null;
  now: Date;
}): Promise<TokenResult> {
  const payload = await verifyAssertion(opts.assertion, opts.signingKey, {
    issuer: opts.origin,
    audience: `${opts.origin}/`,
    now: opts.now,
  });
  if (!payload) {
    return {
      ok: false,
      status: 400,
      body: { error: "invalid_grant", error_description: "The assertion is invalid or expired." },
    };
  }
  const registration = await opts.store.findRegistration(payload.sub);
  if (
    !registration ||
    registration.status !== "active" ||
    registration.expiresAt.getTime() <= opts.now.getTime()
  ) {
    return {
      ok: false,
      status: 400,
      body: { error: "invalid_grant", error_description: "The registration is no longer active." },
    };
  }
  const scopes = parseScopes(payload.scope);
  return {
    ok: true,
    body: await issueTokensFor(opts.store, {
      clientId: opts.clientId,
      userId: null,
      workspaceId: registration.workspaceId,
      registrationId: registration.id,
      scopes: scopes.length > 0 ? scopes : [...AGENT_PRE_CLAIM_SCOPES],
      pepper: opts.pepper,
      now: opts.now,
    }),
  };
}

/** Scopes an agent gains once a human claims the workspace. */
export const CLAIMED_SCOPES = [...AGENT_POST_CLAIM_SCOPES];

/** Cron entry point: expire trials and delete their workspaces. */
export async function runAgentCleanup(
  now: Date = new Date(),
): Promise<{ expired: number; workspacesDeleted: number }> {
  return drizzleRegistrationStore().expireRegistrations(now);
}
