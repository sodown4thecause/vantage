import { and, eq, gt, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  agentAuditLog,
  oauthAuthorizationCode,
  oauthClient,
  oauthToken,
} from "@/lib/db/schema";

export type OAuthClientRecord = {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
};

export type AuthorizationCodeRecord = {
  id: string;
  clientId: string;
  userId: string;
  workspaceId: string | null;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
};

export type TokenRecord = {
  id: string;
  kind: "access" | "refresh";
  clientId: string;
  userId: string | null;
  workspaceId: string | null;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  familyId: string | null;
};

export type AuditEntry = {
  event: string;
  clientId?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
  registrationId?: string | null;
  ipHash?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * Everything the OAuth flows need from storage. Kept as an interface so the
 * flows can be tested without a database, and so the anonymous-registration
 * slice can add methods without touching the human flow.
 */
export type AgentStore = {
  getClient(clientId: string): Promise<OAuthClientRecord | null>;
  createClient(input: OAuthClientRecord): Promise<void>;
  createAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    userId: string;
    workspaceId: string | null;
    scopes: string[];
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Atomically marks the code used. Returns null when it is unknown, used or expired. */
  consumeAuthorizationCode(codeHash: string, now: Date): Promise<AuthorizationCodeRecord | null>;
  createToken(input: {
    tokenHash: string;
    kind: "access" | "refresh";
    clientId: string;
    userId: string | null;
    workspaceId: string | null;
    scopes: string[];
    expiresAt: Date;
    rotatedFrom?: string | null;
    familyId: string;
  }): Promise<void>;
  findToken(tokenHash: string): Promise<TokenRecord | null>;
  /** Atomically revokes. False means it was already revoked or unknown. */
  revokeToken(tokenHash: string, now: Date): Promise<boolean>;
  /**
   * Revokes every live token in one authorization family. Used when a rotated
   * refresh token is replayed: that grant is compromised, so the thief's tokens
   * die with the victim's, while other devices keep working.
   */
  revokeTokenFamily(familyId: string, now: Date): Promise<number>;
  /**
   * Revokes every live token for one client and subject. Used when a token
   * issued before families existed is replayed: its replacement may carry a
   * family this server cannot derive, so the whole subject is revoked.
   */
  revokeTokensForSubject(
    input: { clientId: string; userId: string | null; workspaceId: string | null },
    now: Date,
  ): Promise<number>;
  audit(entry: AuditEntry): Promise<void>;
};

export function drizzleAgentStore(): AgentStore {
  return {
    async getClient(clientId) {
      const [row] = await getDb()
        .select()
        .from(oauthClient)
        .where(eq(oauthClient.id, clientId))
        .limit(1);
      return row
        ? { id: row.id, name: row.name, redirectUris: row.redirectUris ?? [], scopes: row.scopes ?? [] }
        : null;
    },

    async createClient(input) {
      await getDb().insert(oauthClient).values({
        id: input.id,
        name: input.name,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
      });
    },

    async createAuthorizationCode(input) {
      await getDb().insert(oauthAuthorizationCode).values(input);
    },

    async consumeAuthorizationCode(codeHash, now) {
      // One statement: the WHERE clause is the single-use and expiry check, so two
      // concurrent exchanges cannot both succeed.
      const rows = await getDb()
        .update(oauthAuthorizationCode)
        .set({ consumedAt: now })
        .where(
          and(
            eq(oauthAuthorizationCode.codeHash, codeHash),
            isNull(oauthAuthorizationCode.consumedAt),
            gt(oauthAuthorizationCode.expiresAt, now),
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        clientId: row.clientId,
        userId: row.userId,
        workspaceId: row.workspaceId,
        scopes: row.scopes ?? [],
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
      };
    },

    async createToken(input) {
      await getDb().insert(oauthToken).values({
        tokenHash: input.tokenHash,
        kind: input.kind,
        clientId: input.clientId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        rotatedFrom: input.rotatedFrom ?? null,
        familyId: input.familyId,
      });
    },

    async findToken(tokenHash) {
      const [row] = await getDb()
        .select()
        .from(oauthToken)
        .where(eq(oauthToken.tokenHash, tokenHash))
        .limit(1);
      return row
        ? {
            id: row.id,
            kind: row.kind,
            clientId: row.clientId,
            userId: row.userId,
            workspaceId: row.workspaceId,
            scopes: row.scopes ?? [],
            expiresAt: row.expiresAt,
            revokedAt: row.revokedAt,
            familyId: row.familyId,
          }
        : null;
    },

    async revokeToken(tokenHash, now) {
      const rows = await getDb()
        .update(oauthToken)
        .set({ revokedAt: now })
        .where(and(eq(oauthToken.tokenHash, tokenHash), isNull(oauthToken.revokedAt)))
        .returning({ id: oauthToken.id });
      return rows.length > 0;
    },

    async revokeTokenFamily(familyId, now) {
      const rows = await getDb()
        .update(oauthToken)
        .set({ revokedAt: now })
        .where(and(eq(oauthToken.familyId, familyId), isNull(oauthToken.revokedAt)))
        .returning({ id: oauthToken.id });
      return rows.length;
    },

    async revokeTokensForSubject(input, now) {
      const rows = await getDb()
        .update(oauthToken)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthToken.clientId, input.clientId),
            input.userId === null ? isNull(oauthToken.userId) : eq(oauthToken.userId, input.userId),
            input.workspaceId === null
              ? isNull(oauthToken.workspaceId)
              : eq(oauthToken.workspaceId, input.workspaceId),
            isNull(oauthToken.revokedAt),
          ),
        )
        .returning({ id: oauthToken.id });
      return rows.length;
    },

    async audit(entry) {
      await getDb().insert(agentAuditLog).values({
        event: entry.event,
        clientId: entry.clientId ?? null,
        userId: entry.userId ?? null,
        workspaceId: entry.workspaceId ?? null,
        registrationId: entry.registrationId ?? null,
        ipHash: entry.ipHash ?? null,
        detail: entry.detail ?? {},
      });
    },
  };
}
