/**
 * Convenience re-exports so app code can `import { auth } from "@/lib/auth"`.
 * Implementation lives under lib/auth/* per Neon Auth Next.js guidance.
 */
export { auth } from "@/lib/auth/server";
export { authClient } from "@/lib/auth/client";
