import { notFound } from "next/navigation";
import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths } from "@neondatabase/auth-ui/server";

import { Shell } from "@/components/shell";

import s from "./auth.module.css";

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
    <Shell wide>
      <div className={s.layout}>
        <section className={s.intro}>
          <span className={s.mark} aria-hidden="true">✳</span>
          <p className="eyebrow">A little context. A better next move.</p>
          <h1>{path === "sign-up" ? "Your people are already talking." : "Good to have you here."}</h1>
          <p>Find the conversations that matter, understand the evidence, and know what to do next. One workspace for your next useful move.</p>
          <div className={s.promise}><span aria-hidden="true">◈</span><div><strong>Grounded in real conversations</strong><p>Original sources stay beside the answer. You decide what to say, and nothing is posted for you.</p></div></div>
        </section>
        <section className={s.panel} aria-label="Account access">
          <AuthView path={path} />
        </section>
      </div>
    </Shell>
  );
}
