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

export const auth = new Proxy({} as NeonAuth, {
  get(_target, property, receiver) {
    const value = Reflect.get(getAuth() as object, property, receiver) as unknown;
    return typeof value === "function" ? value.bind(getAuth()) : value;
  },
});
