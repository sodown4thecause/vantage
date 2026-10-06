import { auth } from "@/lib/auth/server";

type AuthRouteContext = { params: Promise<{ path: string[] }> };

/**
 * Deferred on purpose. `export const { GET, POST } = auth.handler()` calls
 * `handler()` at module scope, which constructs the Neon Auth client while the
 * build collects route configuration — failing any build that lacks
 * NEON_AUTH_BASE_URL. Resolving the handler inside each exported function defers
 * client construction to request time, when the environment is guaranteed to
 * exist. Keep it this way; see `lib/auth/server.ts`.
 */
export async function GET(request: Request, context: AuthRouteContext) {
  return auth.handler().GET(request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  return auth.handler().POST(request, context);
}
