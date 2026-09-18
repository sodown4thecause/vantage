import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Server-side Neon Auth (Managed Better Auth).
 * Requires NEON_AUTH_BASE_URL + NEON_AUTH_COOKIE_SECRET in the environment.
 */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});
