import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { workspace } from "@/lib/db/schema";

export async function suppressProductEmails(workspaceId: string) {
  await getDb().update(workspace).set({ digestEnabled: false, productEmailSuppressedAt: new Date(), updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId));
}
