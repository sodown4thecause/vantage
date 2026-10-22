import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { clampHour } from "@/lib/digest/schedule";

/** Sets only the digest hour. Delivery and the address stay as they are (opt-in lives on the Daily digest page). */
export async function setDigestHour(workspaceId: string, hourUtc: number): Promise<void> {
  await getDb()
    .update(workspace)
    .set({ digestHourUtc: clampHour(hourUtc), updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId));
}
