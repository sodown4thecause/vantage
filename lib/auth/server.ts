import { createNeonAuth } from "@neondatabase/auth/next/server";

import { neonAuthBaseUrl, neonAuthCookieSecret } from "@/lib/env/server";

/**
 * Server-side Neon Auth (Managed Better Auth).
 * Requires NEON_AUTH_BASE_URL + NEON_AUTH_COOKIE_SECRET in the environment.
 */
export const auth = createNeonAuth({
  baseUrl: neonAuthBaseUrl(),
  cookies: {
    secret: neonAuthCookieSecret(),
  },
});
