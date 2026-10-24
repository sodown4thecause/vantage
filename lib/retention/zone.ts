import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";
import { safeTimeZone } from "@/lib/retention/days";

/** The workspace's stored IANA time zone (set for the digest), or UTC when it has none. */
export async function workspaceTimeZone(workspaceId: string): Promise<string> {
  const [row] = await getDb()
    .select({ timeZone: workspace.digestTimeZone })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return safeTimeZone(row?.timeZone);
}
