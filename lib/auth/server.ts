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

type GetSessionResult = Awaited<ReturnType<NeonAuth["getSession"]>>;

/**
 * A stale or malformed `__Secure-neon-auth.session_data` cookie makes
 * `getSession()` throw, which turned /, /queue, /settings/plan and /success
 * into 500s. Treat a throw from the session check as "signed out"; signing in
 * again overwrites the bad cookie.
 *
 * The client is built OUTSIDE the try so a setup mistake (missing env, short
 * cookie secret) still fails loudly instead of silently signing everyone out.
 * An error object returned by Neon Auth (e.g. it is unreachable) is logged so
 * outages are visible; callers only read `data`.
 */
export async function safeGetSession(
  ...args: Parameters<NeonAuth["getSession"]>
): Promise<GetSessionResult> {
  const client = getAuth();
  let result: GetSessionResult;
  try {
    result = await client.getSession(...args);
  } catch {
    console.warn("auth.getSession failed; treating request as signed out");
    return { data: null, error: null };
  }
  if (result && "error" in result && result.error) {
    console.error("auth.getSession returned an error");
  }
  return result;
}

export const auth = new Proxy({} as NeonAuth, {
  get(_target, property, receiver) {
    if (property === "getSession") return safeGetSession;
    const value = Reflect.get(getAuth() as object, property, receiver) as unknown;
    return typeof value === "function" ? value.bind(getAuth()) : value;
  },
});
