import { createNeonAuth } from "@neondatabase/auth/next/server";

import { requiredEnv } from "@/lib/env/required";

/**
 * Server-side Neon Auth (Managed Better Auth).
 * Requires NEON_AUTH_BASE_URL + NEON_AUTH_COOKIE_SECRET in the environment.
 */
export const auth = createNeonAuth({
  baseUrl: requiredEnv("NEON_AUTH_BASE_URL"),
  cookies: {
    secret: requiredEnv("NEON_AUTH_COOKIE_SECRET"),
  },
});
