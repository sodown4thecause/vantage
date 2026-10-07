import { notFound } from "next/navigation";
import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";

import { Shell } from "@/components/shell";

/**
 * Rendered per request on purpose. This route used to be prerendered with
 * generateStaticParams + dynamicParams=false, but the Worker has no incremental
 * cache (see open-next.config.ts), so the prerendered pages were not served and
 * every /auth/* URL returned 404. Unknown paths still 404 via notFound().
 */
export const dynamic = "force-dynamic";

const VALID_PATHS: ReadonlySet<string> = new Set(Object.values(authViewPaths));

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;
  if (!VALID_PATHS.has(path)) notFound();

  return (
    <Shell>
      <div className="flex justify-center">
        <AuthView path={path} />
      </div>
    </Shell>
  );
}
