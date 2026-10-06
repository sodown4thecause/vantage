import { notFound } from "next/navigation";

import { auth } from "@/lib/auth/server";

/** Parse VANTAGE_ADMIN_USER_IDS: comma-separated, trimmed, empties dropped. */
export function parseAdminIds(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdmin(
  userId: string | null | undefined,
  raw: string | undefined = process.env.VANTAGE_ADMIN_USER_IDS,
): boolean {
  if (!userId) return false;
  return parseAdminIds(raw).includes(userId);
}

/** The signed-in admin's user id, or null for anyone else (including signed out). */
export async function getAdminUserId(): Promise<string | null> {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id ? String(session.user.id) : null;
    return isAdmin(userId) ? userId : null;
  } catch {
    return null;
  }
}

/** For pages and server actions: non-admins get a 404, never a hint the route exists. */
export async function requireAdmin(): Promise<string> {
  const userId = await getAdminUserId();
  if (!userId) notFound();
  return userId;
}
