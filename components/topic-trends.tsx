"use client";

import { useEffect, useState } from "react";

import s from "@/app/workspace/workspace.module.css";

type TopicTrend = {
  topic: string;
  total: number;
  wowChangePct: number | null;
  status: "ok" | "insufficient";
  days: Array<{ day: string; mentions: number }>;
};

type TrendsResponse = { topics: TopicTrend[] };

/**
 * Week-over-week topic trends in the GTM lane: a sparkline per topic. Data
 * appears once scans have recorded topic counts for a few days.
 */
export function TopicTrends({ workspaceId }: { workspaceId: string }) {
  const [topics, setTopics] = useState<TopicTrend[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/workspace/trends?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const parsed = (await response.json()) as TrendsResponse;
        if (!cancelled && Array.isArray(parsed.topics)) setTopics(parsed.topics);
      } catch {
        // A failed load leaves the block out of the lane rather than broken.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!topics) return null;

  return <section className={s.trends} aria-label="Topic trends">
    <div className={s.eyebrow}><span className={s.spark} aria-hidden="true">✳</span> Topic trends</div>
    {topics.length === 0 ? <p>Trends appear after 7 days of scans.</p> : <ul className={s.trendList}>
      {topics.map((topic) => <li key={topic.topic}>
        <span className={s.trendTopic}>{topic.topic}</span>
        <Sparkline days={topic.days.map((d) => d.mentions)} />
        <span className={s.trendWow}>
          {topic.status === "ok" && topic.wowChangePct !== null
            ? `${topic.wowChangePct >= 0 ? "+" : ""}${Math.round(topic.wowChangePct)}% WoW`
            : "Not enough data"}
        </span>
      </li>)}
    </ul>}
  </section>;
}

function Sparkline({ days }: { days: number[] }) {
  const width = 96;
  const height = 24;
  const max = Math.max(1, ...days);
  const step = days.length > 1 ? width / (days.length - 1) : width;
  const points = days
    .map((n, i) => `${(i * step).toFixed(1)},${(height - (n / max) * (height - 2) - 1).toFixed(1)}`)
    .join(" ");
  return <svg className={s.trendSpark} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
    aria-label={`Daily mentions over 28 days, peaking at ${max}`}>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}
