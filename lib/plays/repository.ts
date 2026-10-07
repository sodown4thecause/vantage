import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { monitoringProfile, opportunity, play } from "@/lib/db/schema";
import { getOpportunityDetail } from "@/lib/opportunities/run";
import { classifySituation, type Situation } from "@/lib/pipeline/situation";
import {
  suggestPlays,
  type PlayEffort,
  type PlayKind,
  type VenueMode,
} from "@/lib/plays/suggest";

export type PlayStatus = (typeof play.$inferSelect)["status"];

export type PlayView = {
  id: string;
  workspaceId: string;
  opportunityId: string | null;
  destinationId: string | null;
  kind: PlayKind;
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  status: PlayStatus;
  effortEstimate: PlayEffort;
  createdAt: string;
  doneAt: string | null;
};

/** Statuses a user can move a play to. `suggested` is only the starting state. */
export const SETTABLE_PLAY_STATUSES = ["accepted", "dismissed", "done"] as const;
export type SettablePlayStatus = (typeof SETTABLE_PLAY_STATUSES)[number];

export function isSettablePlayStatus(value: unknown): value is SettablePlayStatus {
  return (
    typeof value === "string" &&
    (SETTABLE_PLAY_STATUSES as readonly string[]).includes(value)
  );
}

/** Thrown when the opportunity or play does not exist in the workspace. */
export class PlayNotFoundError extends Error {
  constructor(what: "opportunity" | "play") {
    super(`${what} not found`);
    this.name = "PlayNotFoundError";
  }
}

function toView(row: typeof play.$inferSelect): PlayView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    destinationId: row.destinationId,
    kind: row.kind,
    title: row.title,
    rationale: row.rationale,
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    status: row.status,
    effortEstimate: row.effortEstimate,
    createdAt: row.createdAt.toISOString(),
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
  };
}

export async function createPlay(opts: {
  workspaceId: string;
  opportunityId: string;
  kind: PlayKind;
  title: string;
  rationale?: string;
  evidence?: Record<string, unknown>;
  effortEstimate?: PlayEffort;
  destinationId?: string | null;
}): Promise<PlayView> {
  const db = getDb();
  const [opp] = await db
    .select({ id: opportunity.id })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.id, opts.opportunityId),
        eq(opportunity.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1);
  if (!opp) throw new PlayNotFoundError("opportunity");

  const [row] = await db
    .insert(play)
    .values({
      workspaceId: opts.workspaceId,
      opportunityId: opts.opportunityId,
      destinationId: opts.destinationId ?? null,
      kind: opts.kind,
      title: opts.title,
      rationale: opts.rationale ?? "",
      evidence: opts.evidence ?? {},
      effortEstimate: opts.effortEstimate ?? "m",
    })
    .returning();
  return toView(row!);
}

export async function listForOpportunity(opts: {
  workspaceId: string;
  opportunityId: string;
}): Promise<PlayView[]> {
  const rows = await getDb()
    .select()
    .from(play)
    .where(
      and(
        eq(play.workspaceId, opts.workspaceId),
        eq(play.opportunityId, opts.opportunityId),
      ),
    )
    .orderBy(asc(play.createdAt));
  return rows.map(toView);
}

export async function setStatus(opts: {
  workspaceId: string;
  playId: string;
  status: SettablePlayStatus;
  now?: Date;
}): Promise<PlayView> {
  const [row] = await getDb()
    .update(play)
    .set({
      status: opts.status,
      doneAt: opts.status === "done" ? (opts.now ?? new Date()) : null,
    })
    .where(and(eq(play.id, opts.playId), eq(play.workspaceId, opts.workspaceId)))
    .returning();
  if (!row) throw new PlayNotFoundError("play");
  return toView(row);
}

/**
 * Venue rules (S30) are not in the schema yet, so every venue is treated as
 * "link only if asked", the conservative default.
 */
const DEFAULT_VENUE_MODE: VenueMode = "link_if_asked";

/**
 * Classify the opportunity's evidence, suggest plays and store the ones that
 * do not exist yet. Kinds already present for the opportunity (including
 * dismissed ones) are never re-created, so dismissing sticks.
 */
export async function suggestForOpportunity(opts: {
  workspaceId: string;
  opportunityId: string;
  venueMode?: VenueMode;
  now?: Date;
}): Promise<PlayView[]> {
  const detail = await getOpportunityDetail({
    workspaceId: opts.workspaceId,
    opportunityId: opts.opportunityId,
  });
  if (!detail) throw new PlayNotFoundError("opportunity");

  const now = opts.now ?? new Date();
  const classified = detail.evidence.map((e) => ({
    documentId: e.documentId,
    result: classifySituation(
      {
        id: e.documentId,
        title: e.title ?? "",
        text: e.contentMd,
        postedAt: e.postedAt ? new Date(e.postedAt) : null,
      },
      now,
    ),
  }));
  // Strongest evidence document decides the situation; first wins ties.
  let best = classified[0];
  for (const c of classified) {
    if (best && c.result.score > best.result.score) best = c;
  }
  const situation: Situation = best?.result.situation ?? "other";

  const db = getDb();
  const [profile] = await db
    .select()
    .from(monitoringProfile)
    .where(eq(monitoringProfile.workspaceId, opts.workspaceId))
    .orderBy(desc(monitoringProfile.version))
    .limit(1);
  const productHasDocs = Boolean(profile?.productMaterialText?.trim());
  const venueMode = opts.venueMode ?? DEFAULT_VENUE_MODE;

  const existing = await listForOpportunity(opts);
  const haveKinds = new Set(existing.map((p) => p.kind));

  const created: PlayView[] = [];
  for (const suggestion of suggestPlays({ situation, venueMode, productHasDocs })) {
    if (haveKinds.has(suggestion.kind)) continue;
    haveKinds.add(suggestion.kind);
    created.push(
      await createPlay({
        workspaceId: opts.workspaceId,
        opportunityId: opts.opportunityId,
        kind: suggestion.kind,
        title: suggestion.title,
        rationale: suggestion.rationale,
        effortEstimate: suggestion.effort,
        evidence: {
          situation,
          venueMode,
          linkPolicy: suggestion.linkPolicy,
          draftAllowed: suggestion.draftAllowed,
          productHasDocs,
          documentIds: detail.evidence.map((e) => e.documentId),
        },
      }),
    );
  }
  return created;
}
