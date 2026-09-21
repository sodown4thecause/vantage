import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-24 font-sans dark:bg-black">
      <main className="w-full max-w-2xl space-y-8 rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Vantage · M1 scaffold
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Social listening foundation
          </h1>
          <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Next.js + Neon Postgres (Drizzle) + Neon Auth, with the free-lane{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm dark:bg-zinc-900">
              Collector
            </code>{" "}
            interface ready for HN / RSS / Substack workers.
          </p>
        </div>

        <ul className="grid gap-3 text-sm text-zinc-700 dark:text-zinc-300 sm:grid-cols-2">
          <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="font-medium">Schema</span>
            <p className="mt-1 text-zinc-500">workspace · source · document · lead</p>
          </li>
          <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="font-medium">Auth</span>
            <p className="mt-1 text-zinc-500">Neon Managed Better Auth routes</p>
          </li>
          <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="font-medium">Collectors</span>
            <p className="mt-1 text-zinc-500">lib/collectors/types.ts contract</p>
          </li>
          <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="font-medium">DB client</span>
            <p className="mt-1 text-zinc-500">lib/db/client.ts via Neon HTTP</p>
          </li>
        </ul>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/auth/sign-in"
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Create account
          </Link>
          <Link
            href="/onboarding"
            className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Onboarding
          </Link>
          <Link
            href="/settings/sources"
            className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Sources
          </Link>
          <Link
            href="/review"
            className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Review queue
          </Link>
        </div>
      </main>
    </div>
  );
}
