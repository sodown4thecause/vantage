import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { sourceSwitch, type SourceSwitchRow, type SourceSwitchState } from "@/lib/db/schema";

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

export async function setSourceSwitch(opts: {
  sourceKey: string;
  state: SourceSwitchState;
  reason?: string;
  changedBy?: string | null;
}): Promise<void> {
  const values = {
    sourceKey: opts.sourceKey,
    state: opts.state,
    reason: opts.reason ?? "",
    changedBy: opts.changedBy ?? null,
    changedAt: new Date(),
  };
  await getDb()
    .insert(sourceSwitch)
    .values(values)
    .onConflictDoUpdate({ target: sourceSwitch.sourceKey, set: values });
}
