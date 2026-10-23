import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { clampHour } from "@/lib/digest/schedule";

/**
 * Sets only the digest time: a local hour in an IANA time zone, converted to UTC at send time. Delivery and the
 * address stay as they are (opt-in lives on the Daily digest page). The zone is stored only if Postgres knows it,
 * because the dispatch query converts with it; an unknown zone is stored as null and the UTC hour applies.
 */
export async function setDigestSchedule(workspaceId: string, schedule: { localHour: number; timeZone: string; hourUtc: number }): Promise<void> {
  await getDb()
    .update(workspace)
    .set({
      digestHourUtc: clampHour(schedule.hourUtc),
      digestLocalHour: clampHour(schedule.localHour),
      digestTimeZone: sql`(select name from pg_timezone_names where name = ${schedule.timeZone} limit 1)`,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId));
}
