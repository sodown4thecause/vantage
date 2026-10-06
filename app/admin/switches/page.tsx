import { requireAdmin } from "@/lib/auth/admin";
import { sourceSwitchStateValues } from "@/lib/db/schema";
import { SOURCE_SWITCH_KEYS, isSourceSwitchKey } from "@/lib/sources/keys";
import { decideSwitch, listSourceSwitches } from "@/lib/sources/switch";
import { updateSwitch } from "./actions";

export const dynamic = "force-dynamic";

export default async function SourceSwitchesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; key?: string }>;
}) {
  await requireAdmin();
  const { status, key: savedKey } = await searchParams;
  const rows = new Map((await listSourceSwitches()).map((row) => [row.sourceKey, row]));

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-3xl space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Source switches
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Pause or block a source type for every workspace. Users see
          &ldquo;Paused by operator&rdquo; with your reason.
        </p>
        {status === "saved" && isSourceSwitchKey(savedKey) && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            Saved {savedKey}.
          </p>
        )}
        {status === "invalid" && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            That change was not valid and was not saved.
          </p>
        )}
        {status === "failed" && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            The change could not be saved. Try again.
          </p>
        )}
        <ul className="space-y-3" data-testid="switch-list">
          {SOURCE_SWITCH_KEYS.map((key) => {
            const row = rows.get(key);
            const state = decideSwitch(row).state;
            return (
              <li key={key} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-zinc-950 dark:text-zinc-50">{key}</p>
                  <span className="text-xs text-zinc-500">
                    {state}
                    {row ? ` · ${row.changedAt.toISOString()}` : ""}
                    {row?.reason ? ` · ${row.reason}` : ""}
                  </span>
                </div>
                <form action={updateSwitch} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="sourceKey" value={key} />
                  <select
                    name="state"
                    defaultValue={state}
                    className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {sourceSwitchStateValues.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    name="reason"
                    defaultValue={row?.reason ?? ""}
                    placeholder="Reason shown to users"
                    maxLength={500}
                    className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    type="submit"
                    className="rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    Save
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
