import Link from "next/link";

import { Mark } from "@/components/glyph";

type NavKey = "queue" | "sources" | "profile" | "plan" | "digest";

export function Shell({
  children,
  workspaceId,
  active,
  wide = false,
}: {
  children: React.ReactNode;
  workspaceId?: string;
  active?: NavKey;
  wide?: boolean;
}) {
  const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const nav: { key: NavKey; label: string; href: string }[] = [
    { key: "queue", label: "Queue", href: `/queue${q}` },
    { key: "sources", label: "Sources", href: `/settings/sources${q}` },
    { key: "profile", label: "Profile", href: `/onboarding${q}` },
    { key: "plan", label: "Plan", href: `/settings/plan${q}` },
    { key: "digest", label: "Digest", href: `/settings/digest${q}` },
  ];

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b border-contour">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-5 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
            <Mark />
            Vantage
          </Link>
          {workspaceId && (
            <nav aria-label="Workspace" className="flex gap-1 text-[0.9375rem]">
              {nav.map((n) => (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-current={active === n.key ? "page" : undefined}
                  className={
                    "rounded px-3 py-1.5 font-medium transition-colors " +
                    (active === n.key
                      ? "bg-ink text-paper"
                      : "text-ridge hover:text-ink")
                  }
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-5 py-10 sm:px-8 sm:py-14 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        {children}
      </main>
    </div>
  );
}

export function PageHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-8 space-y-3">
      <h1 className="display text-4xl sm:text-5xl">{title}</h1>
      {lede && <p className="max-w-[56ch] text-lg leading-snug text-ridge">{lede}</p>}
    </div>
  );
}
