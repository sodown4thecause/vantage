"use client";

import { useState } from "react";

import { SafeLink } from "@/components/safe-link";
import type { Block, ChartBlock, RedditThreadBlock, ResearchCardBlock, TableBlock } from "@/lib/workspace/blocks";
import type { SavedArtifactLane } from "@/lib/workspace/saved-artifact-types";

import s from "./workspace-blocks.module.css";

/*
 * Renders validated answer blocks. Values are untrusted provider or model data: everything renders as React text and
 * only http(s) URLs become links (SafeLink).
 */

const formatCell = (value: string | number | null) =>
  value === null ? "—" : typeof value === "number" ? value.toLocaleString("en-AU") : value;

function RedditThread({ block }: { block: RedditThreadBlock }) {
  return <article className={s.thread}>
    <div className={s.threadMeta}>
      <span>{block.subreddit ? `r/${block.subreddit}` : "Reddit"}</span>
      {block.score !== null && <span>{block.score.toLocaleString("en-AU")} points</span>}
    </div>
    <h3>{block.title}</h3>
    {block.excerpt && <p>{block.excerpt.length > 420 ? `${block.excerpt.slice(0, 420)}…` : block.excerpt}</p>}
    {block.comments.length > 0 && <ol className={s.comments} aria-label="Top comments">
      {block.comments.map((comment, index) => <li key={index}>
        <p>{comment.body.length > 320 ? `${comment.body.slice(0, 320)}…` : comment.body}</p>
        {comment.score !== null && <small>{comment.score.toLocaleString("en-AU")} points</small>}
      </li>)}
    </ol>}
    <SafeLink href={block.url} className={s.link}>Read the thread on Reddit ↗</SafeLink>
  </article>;
}

function ResearchCard({ block }: { block: ResearchCardBlock }) {
  return <article className={s.researchCard}>
    <h3>{block.title}</h3>
    <p>{formatCell(block.value)}</p>
    <SafeLink href={block.sourceUrl} className={s.link}>{block.sourceLabel || "Open source ↗"}</SafeLink>
  </article>;
}

function Table({ block }: { block: TableBlock }) {
  return <div className={s.tableWrap}>
    <table className={s.table}>
      <caption>{block.title}</caption>
      <thead><tr>{block.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>
        {block.rows.length === 0 ? <tr><td colSpan={block.columns.length}>No results.</td></tr>
          : block.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>
            {typeof value === "string" && /^https?:\/\//.test(value) ? <SafeLink href={value} className={s.link}>{value}</SafeLink> : formatCell(value)}
          </td>)}</tr>)}
      </tbody>
    </table>
  </div>;
}

const W = 560;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 40, left: 44 };

/** A small accessible SVG chart. The data also renders as a visually hidden table for screen readers. */
function Chart({ block }: { block: ChartBlock }) {
  const max = Math.max(1, ...block.points.map((point) => point.value));
  const min = Math.min(0, ...block.points.map((point) => point.value));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (value: number) => PAD.top + plotH - ((value - min) / (max - min || 1)) * plotH;
  const step = plotW / block.points.length;
  const x = (index: number) => PAD.left + step * index + step / 2;
  const labelEvery = Math.ceil(block.points.length / 8);
  const line = block.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  return <figure className={s.chart}>
    <figcaption>{block.title}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${block.kind === "bar" ? "Bar" : "Line"} chart: ${block.title}`}>
      {[0, 0.5, 1].map((t) => {
        const value = min + (max - min) * t;
        return <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} className={s.grid} />
          <text x={PAD.left - 6} y={y(value) + 4} textAnchor="end" className={s.axis}>{Math.round(value).toLocaleString("en-AU")}</text>
        </g>;
      })}
      {block.kind === "bar"
        ? block.points.map((point, index) => <rect key={index} x={x(index) - step * 0.35} width={step * 0.7}
          y={Math.min(y(point.value), y(0))} height={Math.abs(y(0) - y(point.value))} rx={3} className={s.bar}>
          <title>{`${point.label}: ${point.value.toLocaleString("en-AU")}`}</title>
        </rect>)
        : <>
          <path d={line} className={s.line} />
          {block.points.map((point, index) => <circle key={index} cx={x(index)} cy={y(point.value)} r={3} className={s.dot}>
            <title>{`${point.label}: ${point.value.toLocaleString("en-AU")}`}</title>
          </circle>)}
        </>}
      {block.points.map((point, index) => index % labelEvery === 0 && <text key={index} x={x(index)} y={H - PAD.bottom + 16} textAnchor="middle" className={s.axis}>{point.label}</text>)}
      {block.xLabel && <text x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle" className={s.axis}>{block.xLabel}</text>}
    </svg>
    <table className="sr-only">
      <caption>{block.title}</caption>
      <thead><tr><th scope="col">{block.xLabel || "Label"}</th><th scope="col">{block.yLabel || "Value"}</th></tr></thead>
      <tbody>{block.points.map((point, index) => <tr key={index}><td>{point.label}</td><td>{point.value}</td></tr>)}</tbody>
    </table>
  </figure>;
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "reddit_thread": return <RedditThread block={block} />;
    case "table": return <Table block={block} />;
    case "chart": return <Chart block={block} />;
    case "research_card": return <ResearchCard block={block} />;
    case "text": return <p className={s.text}>{block.text}</p>;
  }
}

export function BlockList({ blocks, workspaceId, lane, saveTitle, onSaved }: {
  blocks: Block[];
  /** When set, each visual block gets its own Save button. */
  workspaceId?: string;
  lane?: SavedArtifactLane;
  saveTitle?: string;
  onSaved?: (artifact: SavedArtifactSummary) => void;
}) {
  if (!blocks.length) return null;
  return <div className={s.blocks}>{blocks.map((block, index) => <div key={index} className={s.block}>
    <BlockView block={block} />
    {workspaceId && lane && block.type !== "text" && <SaveButton workspaceId={workspaceId} lane={lane}
      title={block.type === "reddit_thread" ? block.title : block.title || saveTitle || "Saved answer"} blocks={[block]} onSaved={onSaved} label="Save visual" />}
  </div>)}</div>;
}

export type SavedArtifactSummary = { id: string; lane: SavedArtifactLane; title: string; blocks: Block[]; createdAt: string };

export function SaveButton({ workspaceId, lane, title, blocks, onSaved, label = "Save" }: {
  workspaceId: string;
  lane: SavedArtifactLane;
  title: string;
  blocks: Block[];
  onSaved?: (artifact: SavedArtifactSummary) => void;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  async function save() {
    if (state === "saving" || state === "saved") return;
    setState("saving");
    try {
      const response = await fetch("/api/workspace/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, lane, title: title.slice(0, 200), blocks }),
      });
      if (!response.ok) throw new Error("save failed");
      const { artifact } = await response.json() as { artifact: SavedArtifactSummary };
      setState("saved");
      onSaved?.(artifact);
    } catch {
      setState("error");
    }
  }
  return <span className={s.save}>
    <button type="button" onClick={() => void save()} disabled={state === "saving" || state === "saved"}>
      {state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : label}
    </button>
    {state === "error" && <span role="alert">Couldn&apos;t save. Try again.</span>}
  </span>;
}
