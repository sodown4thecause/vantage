"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Status = {
  run: { status: "queued" | "running" | "done" | "partial" | "failed"; read: number; relevant: number; picked: number; costUsd: string; capped: boolean } | null;
  nextScanAt: string; timeZone: string; reason: string;
};

export function FirstScanStatus({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshed = false;
    const started = Date.now();
    const poll = async () => {
      try {
        const response = await fetch(`/api/workspace/first-scan?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Status unavailable");
        const value = await response.json() as Status;
        if (controller.signal.aborted) return;
        setData(value);
        setError(false);
        const state = value.run?.status;
        if (state && ["done", "partial"].includes(state) && !refreshed) { refreshed = true; router.refresh(); }
        if (state !== "queued" && state !== "running") return;
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
      }
      if (Date.now() - started < 300_000) timer = setTimeout(poll, 3000);
      else setPaused(true);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [workspaceId, attempt, router]);

  async function retry() {
    setRetrying(true);
    try {
      const response = await fetch("/api/workspace/first-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }) });
      if (!response.ok) throw new Error("Retry unavailable");
      setData(null);
      setPaused(false);
      setAttempt((value) => value + 1);
    } catch {
      setError(true);
    } finally {
      setRetrying(false);
    }
  }

  if (!data?.run && !error) return null;
  const run = data?.run;
  const scanning = run?.status === "queued" || run?.status === "running";
  let next = "";
  if (data) {
    try { next = new Intl.DateTimeFormat("en-AU", { timeZone: data.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(data.nextScanAt)); } catch {}
  }
  return <section className="my-6 space-y-3 rounded-xl border border-contour p-5" aria-live="polite" data-testid="first-scan-status">
    <h2 className="text-lg font-semibold">{!run && error ? "Scan status unavailable" : scanning ? "Your first scan is underway" : run?.status === "failed" ? "Your first scan couldn’t finish" : run?.picked ? "Your first conversations are ready" : "Nothing strong yet"}</h2>
    {run && <p>{run.read.toLocaleString("en-AU")} read · {run.relevant.toLocaleString("en-AU")} relevant · {run.picked} worth reviewing</p>}
    {run?.status === "partial" && <p>Coverage is incomplete{run.capped ? " because a scan allowance was reached" : " because some sources could not be read"}. Any conversations shown still have real evidence.</p>}
    {!scanning && run?.status !== "failed" && !run?.picked && <p>{data?.reason} {next && `Next scan due ${next} (${data?.timeZone}).`}</p>}
    {run?.status === "failed" && <button className="btn" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Retry first scan"}</button>}
    {(error || paused) && <p>{error ? "Scan status is temporarily unavailable." : "The scan may still be running; automatic checks have paused after five minutes."} <button className="link" onClick={() => { setPaused(false); setAttempt((value) => value + 1); }}>Check again</button></p>}
    <Link className="link text-sm" href={`/queue?workspaceId=${encodeURIComponent(workspaceId)}`}>Review your queue</Link>{" · "}
    <Link className="link text-sm" href={`/workspace?workspaceId=${encodeURIComponent(workspaceId)}&setup=1`}>Edit your profile</Link>
  </section>;
}
