"use client";

import { useEffect, useState } from "react";
import { BlockList, type SavedArtifactSummary } from "@/components/workspace-blocks";
import { gtmDataSchemas, type GtmUIMessage } from "@/lib/gtm/chat/types";
import type { GtmJob } from "@/lib/gtm/chat/jobs";
import type { StrategyState } from "@/lib/gtm/proposals/types";
import type { GtmProposalView } from "@/lib/gtm/chat/types";
import { SafeLink } from "@/components/safe-link";
import { parseBlocks } from "@/lib/workspace/blocks";

function Proposal({ initial, onConfirmed }: { initial: GtmProposalView; onConfirmed?: (state: StrategyState) => void }) {
  const [proposal, setProposal] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, unknown> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [decision, setDecision] = useState<{ requestId: string; approved: boolean } | null>(null);
  const url = `/api/gtm/proposals/${encodeURIComponent(proposal.id)}`;
  useEffect(() => {
    let active = true;
    void fetch(`${url}?${new URLSearchParams({ workspaceId: initial.workspaceId, conversationId: initial.conversationId })}`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const body = await response.json(), result = gtmDataSchemas.proposal.parse(body.proposal);
      if (!body.state || typeof body.state !== "object") throw new Error();
      if (active) { setProposal({ ...result, discovery: result.discovery ?? initial.discovery }); setConfirmed(body.state); }
    }).catch(() => { if (active) { setConfirmed(null); setError("Confirmed state unavailable. Reload it before confirming."); } });
    return () => { active = false; };
  }, [url, initial.workspaceId, initial.conversationId, initial.discovery, refreshKey]);
  async function respond(approved: boolean) {
    if (busy || (approved && !confirmed)) return;
    setBusy(true); setError("");
    const chosen = decision ?? { requestId: crypto.randomUUID(), approved };
    setDecision(chosen);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: proposal.workspaceId, conversationId: proposal.conversationId, strategyVersion: proposal.strategyVersion, payloadHash: proposal.payloadHash, requestId: chosen.requestId, state: "approval-responded", approval: { id: proposal.id, approved: chosen.approved } }) });
      if (!response.ok) throw new Error();
      setProposal({ ...proposal, status: chosen.approved ? "applied" : "denied" });
      if (chosen.approved) {
        const refreshed = await fetch(`${url}?${new URLSearchParams({ workspaceId: proposal.workspaceId, conversationId: proposal.conversationId })}`, { cache: "no-store" });
        if (refreshed.ok) { const body = await refreshed.json(); setConfirmed(body.state); onConfirmed?.(body.state); }
      }
    } catch { setError("Couldn’t confirm this exact proposal. Retry the same decision, or ask for a refreshed proposal."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Proposed strategy changes" className="my-4 rounded-xl border border-line p-4">
    <h3>Proposed changes</h3><p>Based on strategy version {proposal.strategyVersion}. Status: {proposal.status}.</p>
    <p>Expires <time dateTime={proposal.expiresAt}>{new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(proposal.expiresAt))} UTC</time>.</p>
    <div className="overflow-x-auto"><table><caption>Exact proposed diff</caption><thead><tr><th scope="col">Field</th><th scope="col">Currently confirmed</th><th scope="col">Proposed</th></tr></thead><tbody>{Object.entries(proposal.payload).flatMap(([field, value]) => {
      if (field === "profile" && value && typeof value === "object") return Object.entries(value).map(([key, next]) => ({ field: `profile.${key}`, before: (confirmed?.profile as Record<string, unknown> | null)?.[key], after: next }));
      return [{ field, before: confirmed?.[field], after: value }];
    }).map(row => <tr key={row.field}><th scope="row">{row.field}</th><td><pre className="whitespace-pre-wrap break-words text-sm">{confirmed ? JSON.stringify(row.before ?? "Not recorded", null, 2) : error ? "Confirmed state unavailable" : "Loading confirmed state…"}</pre></td><td><pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(row.after, null, 2)}</pre></td></tr>)}</tbody></table></div>
    <p>Nothing changes until you confirm this exact proposal.</p>
    {proposal.status === "pending" && <div className="flex gap-3"><button type="button" disabled={busy || !confirmed || decision?.approved === false} onClick={() => void respond(true)}>Confirm changes</button><button type="button" disabled={busy || decision?.approved === true} onClick={() => void respond(false)}>Deny changes</button></div>}
    {proposal.discovery && <section aria-label="Discovery evidence" className="mt-4 rounded-lg border border-line p-3">
      <h4>Evidence and research gaps</h4>
      <p><strong>Product:</strong> {proposal.discovery.plan.profile.productDescription} <EvidenceRefs ids={proposal.discovery.plan.profile.evidenceIds} evidence={proposal.discovery.evidence} /> <span>Audience: {proposal.discovery.plan.profile.targetCustomer} <EvidenceRefs ids={proposal.discovery.plan.profile.evidenceIds} evidence={proposal.discovery.evidence} /></span></p>
      <p><SafeLink href={proposal.discovery.plan.profile.productUrl}>Read researched product page</SafeLink></p>
      {proposal.discovery.plan.competitors.length > 0 && <><h5>Evidence-backed competitor candidates</h5><ul>{proposal.discovery.plan.competitors.map(item => <li key={item.domain}><strong>{item.domain}</strong> — {item.positioning} <EvidenceRefs ids={item.evidenceIds} evidence={proposal.discovery!.evidence} /></li>)}</ul></>}
      {proposal.discovery.plan.keywords.length > 0 && <><h5>Keyword candidates</h5><ul>{proposal.discovery.plan.keywords.map(item => <li key={item.term}><strong>{item.term}</strong> — {item.reason} <EvidenceRefs ids={item.evidenceIds} evidence={proposal.discovery!.evidence} /></li>)}</ul></>}
      {proposal.discovery.plan.sources.length > 0 && <><h5>Paused source candidates</h5><ul>{proposal.discovery.plan.sources.map((item, index) => <li key={`${item.type}-${item.config.query}-${index}`}><strong>{item.type}</strong>: {item.config.query} — {item.reason} <EvidenceRefs ids={item.evidenceIds} evidence={proposal.discovery!.evidence} />{item.sampleUrls.map(sample => <span key={sample}> · Sample: <SafeLink href={sample}>read</SafeLink></span>)}</li>)}</ul></>}
      <ul>{proposal.discovery.evidence.map(item => <li key={item.id}>
        <SafeLink href={item.url}>Read source</SafeLink> · {item.provider} · Retrieved <time dateTime={item.retrievedAt}>{new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(item.retrievedAt))} UTC</time>
        <blockquote className="my-2 border-l-2 border-line pl-3">{item.excerpt}</blockquote>
      </li>)}</ul>
      {proposal.discovery.unknowns.length > 0 && <><h5>Unknowns</h5><ul>{proposal.discovery.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      <p><strong>Cadence:</strong> {proposal.discovery.cadence.note}</p>
      <p><strong>Cost:</strong> {proposal.discovery.cost.note}</p>
    </section>}
    {error && !confirmed && <button type="button" onClick={() => { setError(""); setRefreshKey(value => value + 1); }}>Retry loading confirmed state</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function EvidenceRefs({ ids, evidence }: { ids: string[]; evidence: Array<{ id: string; url: string }> }) {
  const byId = new Map(evidence.map(item => [item.id, item.url]));
  return <span> Evidence: {ids.map((id, index) => {
    const url = byId.get(id);
    return url ? <span key={id}>{index ? ", " : ""}<SafeLink href={url}>source {index + 1}</SafeLink></span> : null;
  })}</span>;
}

function Job({ initial }: { initial: GtmJob }) {
  const [job, setJob] = useState(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/gtm/jobs/${encodeURIComponent(initial.id)}`;
  const active = ["queued", "running", "cancel_requested"].includes(job.state);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${url}?${new URLSearchParams({ workspaceId: initial.workspaceId })}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const fresh = gtmDataSchemas.job.parse(await response.json());
        if (!disposed) { setJob(fresh); setError(""); }
      } catch { if (!disposed) setError("Progress unavailable. The scan may still be running."); }
    };
    void refresh();
    const timer = active ? setInterval(() => void refresh(), 4000) : undefined;
    return () => { disposed = true; if (timer) clearInterval(timer); };
  }, [url, initial.workspaceId, active]);
  async function cancel() {
    setBusy(true);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: initial.workspaceId, requestId: crypto.randomUUID(), action: "cancel" }) });
      if (!response.ok) throw new Error();
      setJob(gtmDataSchemas.job.parse(await response.json()));
    } catch { setError("Couldn’t request cancellation. Refresh progress before trying again."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Durable scan" className="my-4 rounded-xl border border-line p-4">
    <h3>Scan <span role="status">{job.state === "complete" ? "complete" : job.state.replaceAll("_", " ")}</span></h3>
    <p className="break-all text-sm">Job {job.id}</p>
    {job.state === "cancel_requested" && <p>Cancellation requested. The current step and cost accounting must finish first.</p>}
    {job.health && <p>{job.health.verified} verified of {job.health.discovered} discovered. Coverage: {job.health.state}.</p>}
    {active && job.state !== "cancel_requested" && <button type="button" disabled={busy} onClick={() => void cancel()}>Cancel scan</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function GtmChatParts({ message, workspaceId, onSaved, onConfirmed }: { message: GtmUIMessage; workspaceId: string; onSaved?: (item: SavedArtifactSummary) => void; onConfirmed?: (state: StrategyState) => void }) {
  return <>{message.parts.map((part, index) => {
    if (part.type === "text") return <div key={index} className="whitespace-pre-wrap">{part.text}</div>;
    if (part.type === "data-proposal") return <Proposal key={part.data.id} initial={part.data} onConfirmed={onConfirmed} />;
    if (part.type === "data-job") return <Job key={part.data.id} initial={part.data} />;
    if (part.type === "data-turn") return part.data.state === "interrupted" ? <p key={index} role="status">This answer was interrupted. Saved parts remain available; you can continue with a new message.</p> : null;
    if (part.type === "data-interview") return <details key={index}><summary>Earlier product setup (draft history)</summary><pre className="whitespace-pre-wrap">{JSON.stringify(part.data, null, 2)}</pre></details>;
    if (part.type === "data-card" || (part.type === "tool-show_card" && part.state === "output-available")) {
      const card = part.type === "data-card" ? part.data : part.output;
      const data = card.data && typeof card.data === "object" ? card.data as Record<string, unknown> : {};
      const blocks = parseBlocks(data.blocks);
      return <section key={index}><h3>{card.title}</h3>{blocks.length ? <BlockList blocks={blocks} workspaceId={workspaceId} lane="gtm" onSaved={onSaved} /> : <details><summary>Earlier saved context</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(card.data, null, 2)}</pre></details>}</section>;
    }
    return null;
  })}</>;
}
