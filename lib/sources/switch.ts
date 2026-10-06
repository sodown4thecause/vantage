import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  sourceSwitch,
  sourceSwitchLog,
  type SourceSwitchRow,
  type SourceSwitchState,
} from "@/lib/db/schema";

export type SwitchDecision = {
  enabled: boolean;
  state: SourceSwitchState;
  reason: string;
};

/** No row means the source is on. Only an explicit "on" row runs the collector. */
export function decideSwitch(
  row: Pick<SourceSwitchRow, "state" | "reason"> | undefined | null,
): SwitchDecision {
  if (!row || row.state === "on") {
    return { enabled: true, state: "on", reason: "" };
  }
  return {
    enabled: false,
    state: row.state,
    reason: row.reason || `${row.state} by operator`,
  };
}

/**
 * Look up a source's global switch. If the lookup itself fails the source is
 * treated as on: a missing switch table must not take every collector down.
 */
export async function getSourceSwitch(sourceKey: string): Promise<SwitchDecision> {
  try {
    const [row] = await getDb()
      .select()
      .from(sourceSwitch)
      .where(eq(sourceSwitch.sourceKey, sourceKey))
      .limit(1);
    return decideSwitch(row);
  } catch (err) {
    console.error("[switch] lookup failed; treating source as on", {
      sourceKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return decideSwitch(null);
  }
}

/** Every switch row that exists. Source keys with no row are on. */
export async function listSourceSwitches(): Promise<SourceSwitchRow[]> {
  return getDb().select().from(sourceSwitch);
}

/** Switches that are off, for labelling sources. Lookup failure means none. */
export async function listOffSwitches(): Promise<Map<string, SwitchDecision>> {
  const out = new Map<string, SwitchDecision>();
  try {
    for (const row of await listSourceSwitches()) {
      const decision = decideSwitch(row);
      if (!decision.enabled) out.set(row.sourceKey, decision);
    }
  } catch (err) {
    console.error("[switch] list failed; treating sources as on", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

export async function setSourceSwitch(opts: {
  sourceKey: string;
  state: SourceSwitchState;
  reason?: string;
  changedBy?: string | null;
}): Promise<void> {
  const db = getDb();
  const values = {
    sourceKey: opts.sourceKey,
    state: opts.state,
    reason: opts.reason ?? "",
    changedBy: opts.changedBy ?? null,
    changedAt: new Date(),
  };
  // One atomic batch (neon-http has no interactive transactions). The log row
  // comes first and reads from_state in SQL, so a concurrent edit cannot log a
  // stale state and a live switch can never exist without its audit row.
  await db.batch([
    db.insert(sourceSwitchLog).values({
      sourceKey: values.sourceKey,
      fromState: sql<SourceSwitchState>`coalesce((select ${sourceSwitch.state} from ${sourceSwitch} where ${sourceSwitch.sourceKey} = ${values.sourceKey}), 'on')`,
      toState: values.state,
      reason: values.reason,
      changedBy: values.changedBy,
      changedAt: values.changedAt,
    }),
    db
      .insert(sourceSwitch)
      .values(values)
      .onConflictDoUpdate({ target: sourceSwitch.sourceKey, set: values }),
  ]);
}
