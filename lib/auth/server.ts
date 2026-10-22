import { createNeonAuth } from "@neondatabase/auth/next/server";

import { requiredEnv } from "@/lib/env/required";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let instance: NeonAuth | undefined;

/**
 * Server-side Neon Auth (Managed Better Auth).
 * Requires NEON_AUTH_BASE_URL + NEON_AUTH_COOKIE_SECRET.
 *
 * Construction is deferred to first use. Building it eagerly reads the
 * environment at import time, and `app/api/auth/[...path]/route.ts` evaluates
 * `auth.handler()` at module scope — so the build would fail whenever those
 * variables are absent. A `Proxy` is required rather than a plain lazy function
 * because that route destructures `auth` immediately; a plain getter would be
 * defeated by the destructuring itself.
 *
 * Mirrors the pattern in `lib/db/client.ts`, where `getDb()` is lazy for the
 * same reason. Do not move `requiredEnv` back to module scope.
 */
function getAuth(): NeonAuth {
  instance ??= createNeonAuth({
    baseUrl: requiredEnv("NEON_AUTH_BASE_URL"),
    cookies: {
      secret: requiredEnv("NEON_AUTH_COOKIE_SECRET"),
    },
  });
  return instance;
}

/**
 * A stale or malformed `__Secure-neon-auth.session_data` cookie makes
 * `getSession()` throw, which turned /, /queue, /settings/plan and /success
 * into 500s. Treat any failure as "signed out" instead; signing in again
 * overwrites the bad cookie.
 */
async function safeGetSession(
  ...args: Parameters<NeonAuth["getSession"]>
): Promise<Awaited<ReturnType<NeonAuth["getSession"]>>> {
  const client = getAuth();
  try {
    const result = await client.getSession(...args);
    if (result.error) console.warn("auth.getSession returned an error");
    return result;
  } catch {
    console.warn("auth.getSession failed; treating request as signed out");
    return { data: null, error: null };
  }
}

export const auth = new Proxy({} as NeonAuth, {
  get(_target, property, receiver) {
    if (property === "getSession") return safeGetSession;
    const value = Reflect.get(getAuth() as object, property, receiver) as unknown;
    return typeof value === "function" ? value.bind(getAuth()) : value;
  },
});
