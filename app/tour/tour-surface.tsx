"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ANSWER_ENGINES,
  EVIDENCE,
  GSC_ROWS,
  PANELS,
  PREVIEW,
  QUEUE,
  RELEVANT,
  SOURCE_READS,
  STREAM,
  TOTAL_READ,
  WHY_RANKED,
  WORKSPACE,
  type PanelId,
} from "@/app/tour/tour-data";
import { Glyph, Mark } from "@/components/glyph";
import { pickForumDomains } from "@/lib/communities/forum-packs";
import { DRAFT, EDIT_COUNT, editState, stepForProgress } from "@/lib/tour/edit-pass";
import type { ScrollCraftApi } from "@/lib/vendor/scrollcraft/scrollcraft.js";

import s from "./tour.module.css";

const fmt = new Intl.NumberFormat("en-US");
const MAX_READ = Math.max(...SOURCE_READS.map((r) => r.read));

/** Progress (0..1) of a pinned act, computed the way the engine does: travel = height minus one viewport. */
function pinnedProgress(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, -r.top / Math.max(r.height - innerHeight, 1)));
}

function Preview({ id }: { id: PanelId }) {
  return PREVIEW.has(id) ? <span className={s.preview}>Preview</span> : null;
}

export function TourSurface() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<PanelId>("queue");

  // The engine is client-only (it touches window at import) and must be torn down on route change.
  useEffect(() => {
    let api: ScrollCraftApi | undefined;
    let cancelled = false;
    import("@/lib/vendor/scrollcraft/scrollcraft.js").then(() => {
      if (!cancelled && rootRef.current && window.ScrollCraft) api = window.ScrollCraft.mount(rootRef.current);
    });
    return () => {
      cancelled = true;
      api?.destroy();
    };
  }, []);

  // The sidebar is the navigation, so it tracks which panel is under the reader.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = innerHeight * 0.4;
      let current: PanelId = "queue";
      for (const p of PANELS) {
        const el = document.getElementById(p.id);
        if (el && el.getBoundingClientRect().top <= line) current = p.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const top = QUEUE[0];

  return (
    <div ref={rootRef} className={s.tour}>
      <a href="#queue" className="skip-link">
        Skip to the workspace
      </a>

      <aside className={s.side} aria-label="Demo workspace">
        <Link href="/" className={s.brand} aria-label="contextfor.dev home">
          <Mark />
          <span>
            contextfor<span className={s.tld}>.dev</span>
          </span>
        </Link>
        <p className={s.ws}>
          <strong>{WORKSPACE}</strong>
          <span>Demo workspace</span>
        </p>
        <nav aria-label="Workspace panels">
          <ol className={s.navList}>
            {PANELS.map((p) => (
              <li key={p.id}>
                <a href={`#${p.id}`} aria-current={active === p.id ? "location" : undefined} className={s.navItem}>
                  {p.label}
                  <Preview id={p.id} />
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <p className={s.sample}>Sample data. Nothing in this workspace is live.</p>
        <p className={s.sideCta}>
          <Link href="/auth/sign-up" className="btn">
            Create free account
          </Link>
          <Link href="/auth/sign-in" className="link">
            Sign in
          </Link>
        </p>
      </aside>

      <header className={s.bar}>
        <Link href="/" className={s.brand} aria-label="contextfor.dev home">
          <Mark />
        </Link>
        <details className={s.menu}>
          <summary>
            {WORKSPACE} demo: {PANELS.find((p) => p.id === active)?.label}
          </summary>
          <ol>
            {PANELS.map((p) => (
              <li key={p.id}>
                <a href={`#${p.id}`} onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}>
                  {p.label}
                  <Preview id={p.id} />
                </a>
              </li>
            ))}
          </ol>
        </details>
        <Link href="/auth/sign-up" className={s.barCta}>
          Create free account
        </Link>
      </header>

      <main className={s.main}>
        {/* Queue: three planes. The raw stream recedes, the list holds, the top card lifts toward the reader. */}
        <section id="queue" data-sc-act="pin" data-sc-span="1.8" aria-labelledby="queue-title">
          <div data-sc-stage className={s.heroStage}>
            <ul className={s.stream} data-sc-parallax="-3" aria-hidden="true">
              {STREAM.map((p, i) => (
                <li key={i}>
                  <span>{p.source}</span> {p.text}
                </li>
              ))}
            </ul>
            <div className={s.heroInner}>
              <p className={s.status}>Monday, 08:00. Digest sent to you@tracewell.dev</p>
              <h1 id="queue-title" className={s.heroTitle}>
                Five conversations worth joining today
              </h1>
              <p className={s.help}>
                A GTM workspace for AI and developer tools: threads from Reddit, X, Hacker News and forums, ranked next to
                your search data.
              </p>
              <div className={s.heroPlanes}>
                <ol className={s.queue} data-sc-parallax="0.4">
                  {QUEUE.map((q, i) => (
                    <li key={q.title} className={i === 0 ? s.queueFirst : undefined}>
                      <Glyph features={q.features} size={34} />
                      <div>
                        <p className={s.qMeta}>
                          {q.source}, {q.where}, {q.age} ago
                        </p>
                        <p className={s.qTitle}>{q.title}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <article className={s.lift} data-sc-parallax="1.4" aria-label="Top conversation">
                  <Glyph features={top.features} size={150} labels />
                  <p className={s.qMeta}>
                    Ranked first: {top.source}, {top.where}
                  </p>
                  <p className={`quote ${s.liftQuote}`}>{top.title}</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        {/* Sources: counters run with the section's own travel. */}
        <section id="sources" data-sc-act="flow" className={s.flowAct} aria-labelledby="sources-title">
          <div className={s.sourcesGrid}>
            <div className={s.sourcesHead}>
              <h2 id="sources-title" className={s.panelTitle}>
                Overnight, ten sources
              </h2>
              <p className={s.panelLede}>
                Collectors read every source on a schedule, drop duplicates and score each post for fit, intent,
                evidence, momentum and timing. Most of it is noise.
              </p>
              <dl className={s.funnel}>
                <div>
                  <dt>Read</dt>
                  <dd data-sc-count={`0 ${fmt.format(TOTAL_READ)}`} data-sc-count-at="0.12 0.34">
                    {fmt.format(TOTAL_READ)}
                  </dd>
                </div>
                <div>
                  <dt>Relevant</dt>
                  <dd data-sc-count={`0 ${RELEVANT}`} data-sc-count-at="0.32 0.44">
                    {RELEVANT}
                  </dd>
                </div>
                <div className={s.funnelLast}>
                  <dt>Worth joining</dt>
                  <dd data-sc-count={`0 ${QUEUE.length}`} data-sc-count-at="0.42 0.52">
                    {QUEUE.length}
                  </dd>
                </div>
              </dl>
            </div>
            <table className={s.sourceTable}>
              <caption className={s.srOnly}>Posts read per source in the sample run</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Posts read</th>
                </tr>
              </thead>
              <tbody>
                {SOURCE_READS.map((r) => (
                  <tr key={r.source}>
                    <th scope="row">{r.source}</th>
                    <td>
                      <span className={s.meterWrap}>
                        <span className={s.meter} style={{ "--w": r.read / MAX_READ } as React.CSSProperties} aria-hidden="true" />
                        <span data-sc-count={`0 ${r.read}`} data-sc-count-at="0.1 0.34">
                          {r.read}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Opportunity: evidence arrives in order while the glyph fills. */}
        <section id="opportunity" data-sc-act="pin" data-sc-span="2" aria-labelledby="opp-title">
          <div data-sc-stage className={s.oppStage}>
            <div className={s.oppHead}>
              <div className={s.oppGlyph}>
                <Glyph features={top.features} size={210} labels />
              </div>
              <div>
                <p className={s.qMeta}>
                  {top.source}, {top.where}, {top.age} ago
                </p>
                <h2 id="opp-title" className={s.oppTitle}>
                  {top.title}
                </h2>
              </div>
            </div>
            <div className={s.oppBody}>
              <ol className={s.evidence} aria-label="Evidence">
                {EVIDENCE.map((e, i) => (
                  <li key={e.who} data-sc-cue={String(0.06 + i * 0.2)}>
                    <p className={s.qMeta}>
                      {e.source}, {e.who}
                    </p>
                    <blockquote className="quote">{e.text}</blockquote>
                  </li>
                ))}
              </ol>
              <div className={s.why} data-sc-cue="0.68">
                <h3>Why it ranked</h3>
                <ul>
                  {WHY_RANKED.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Reply: the composer wipes open, empty, for the owner to write. */}
        <section id="reply" data-sc-act="flow" className={s.flowAct} aria-labelledby="reply-title">
          <div className={s.replyGrid}>
            <div>
              <h2 id="reply-title" className={s.panelTitle}>
                You write the reply
              </h2>
              <p className={s.panelLede}>
                contextfor.dev suggests an approach and shows the posts behind it. It never posts, comments or sends
                messages for you.
              </p>
              <h3 className={s.minorHead}>Suggested approach</h3>
              <ul className={s.approach}>
                <li>Answer the retry question first: how to spot a loop in the logs they already have.</li>
                <li>Mention Tracewell once, and say you build it.</li>
                <li>Link the trace example, not the pricing page.</li>
              </ul>
            </div>
            <Composer />
          </div>
        </section>

        {/* Search: lateral travel across Search Console and three answer engines, ending on the gap. */}
        <section id="search" data-sc-act="pan" data-sc-span="3" aria-labelledby="search-title">
          <div data-sc-stage className={s.panStage}>
            <div className={s.rail} data-sc-pan="0">
              <div className={s.railLead}>
                <h2 id="search-title" className={s.panelTitle}>
                  The same question, in search <Preview id="search" />
                </h2>
                <p className={s.panelLede}>
                  People who post about agent loops also search for them. Search Console shows what they type; the
                  answer engines show who gets cited.
                </p>
              </div>
              <article className={`${s.railPanel} ${s.gscPanel}`} aria-labelledby="gsc-title">
                <h3 id="gsc-title">Google Search Console</h3>
                <p className={s.qMeta}>tracewell.dev, queries, last 28 days</p>
                <table className={s.gscTable}>
                  <thead>
                    <tr>
                      <th scope="col">Query</th>
                      <th scope="col">Impressions</th>
                      <th scope="col">Clicks</th>
                      <th scope="col">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GSC_ROWS.map((r) => (
                      <tr key={r.query} className={r.gap ? s.gapRow : undefined}>
                        <th scope="row">{r.query}</th>
                        <td>{fmt.format(r.impressions)}</td>
                        <td>{r.clicks}</td>
                        <td>{r.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
              {ANSWER_ENGINES.map((a) => (
                <article key={a.engine} className={s.railPanel} aria-label={`${a.engine} answer check`}>
                  <h3>{a.engine}</h3>
                  <p className={s.prompt}>{a.prompt}</p>
                  <p className={s.cited}>{a.cited ? "Cites tracewell.dev" : "Does not cite tracewell.dev"}</p>
                  <p className={s.qMeta}>{a.note}</p>
                </article>
              ))}
              <article className={`${s.railPanel} ${s.gapPanel}`} aria-labelledby="gap-title">
                <h3 id="gap-title">Gap: debug agent loop</h3>
                <p>
                  1,880 impressions at position 34, three clicks, and no answer engine cites you. The Reddit thread above
                  is the same question.
                </p>
                <a href="#content" className="btn">
                  Draft a page for this
                </a>
              </article>
            </div>
          </div>
        </section>

        {/* Content: the peak. The scroll is the editor. */}
        <EditPass />

        {/* Start: a real input. The reader's words pick the forums the workspace would read. */}
        <section id="start" data-sc-act="flow" className={`${s.flowAct} ${s.startAct}`} aria-labelledby="start-title">
          <StartInput />
          <footer className={s.foot}>
            <Link href="/" className="link">
              Home
            </Link>
            <Link href="/pricing" className="link">
              Pricing
            </Link>
            <Link href="/blog" className="link">
              Blog
            </Link>
            <span>This tour uses sample data. Search Console, answer checks and the humanizer are in preview.</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form className={s.composer} data-sc-reveal="left" data-sc-reveal-at="0.12 0.42" onSubmit={(e) => e.preventDefault()}>
      <p className={s.qMeta}>Replying to u/quietgradient in r/LocalLLaMA</p>
      <label htmlFor="tour-reply" className={s.minorHead}>
        Your reply
      </label>
      <textarea
        id="tour-reply"
        rows={6}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCopied(false);
        }}
        placeholder="Write it the way you would explain it to a colleague."
      />
      <div className={s.composerFoot}>
        <button type="button" className="btn" onClick={copy} disabled={!text.trim()}>
          Copy reply
        </button>
        <p className={s.qMeta} aria-live="polite">
          {copied ? "Copied. Paste it into the thread from your own account." : "There is no post button. You send it yourself."}
        </p>
      </div>
    </form>
  );
}

function EditPass() {
  const actRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (actRef.current) setStep(stepForProgress(pinnedProgress(actRef.current)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  let n = 0;
  const pieces = DRAFT.map((piece, i) => {
    if (piece.kind === "text") return <span key={i}>{piece.text}</span>;
    const state = editState(n++, step);
    if (state === "fixed") return <ins key={i} className={s.fixed}>{piece.after}</ins>;
    return (
      <span key={i} className={state === "marked" ? s.marked : undefined}>
        {piece.before}
      </span>
    );
  });

  let k = 0;
  const log = DRAFT.flatMap((piece) => (piece.kind === "edit" ? [{ ...piece, state: editState(k++, step) }] : []));
  const done = log.filter((e) => e.state === "fixed").length;

  return (
    <section id="content" ref={actRef} data-sc-act="pin" data-sc-span="4" aria-labelledby="content-title">
      <div data-sc-stage className={s.editStage}>
        <div className={s.editHead}>
          <h2 id="content-title" className={s.panelTitle}>
            Humanizer <Preview id="content" />
          </h2>
          <p className={s.panelLede}>
            A first draft for &ldquo;debug agent loop&rdquo;, written from the thread and the query. The humanizer marks
            what reads as machine-written and rewrites it in your voice.
          </p>
        </div>
        <div className={s.editBody}>
          <article className={s.draft} aria-label="Draft">
            <p className={s.qMeta}>Draft: How to debug an agent that keeps retrying a tool call</p>
            <p className={s.draftText}>{pieces}</p>
          </article>
          <div className={s.editLog}>
            <p className={s.editCount}>
              <span className="tour-clip">Edit progress: </span>
              {done} of {EDIT_COUNT} edits
            </p>
            <ol>
              {log.map((e) => (
                <li key={e.rule} data-state={e.state}>
                  {e.rule}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

const CORE_SOURCES = ["Reddit", "Hacker News", "X", "GitHub", "Stack Overflow"];

function StartInput() {
  const [text, setText] = useState("");
  const forums = useMemo(() => (text.trim().length >= 3 ? pickForumDomains(text).slice(0, 8) : []), [text]);

  return (
    <div className={s.start}>
      <h2 id="start-title" className={s.panelTitle}>
        Set up your own
      </h2>
      <label htmlFor="tour-product" className={s.minorHead}>
        What do you build, and for whom?
      </label>
      <textarea
        id="tour-product"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="An open-source SDK that traces LLM agents, for developers running them in production"
      />
      <div className={s.watch} aria-live="polite">
        {forums.length ? (
          <>
            <p className={s.minorHead}>Your workspace would read</p>
            <p>
              {CORE_SOURCES.join(", ")}, and these forums: {forums.join(", ")}.
            </p>
          </>
        ) : (
          <p className={s.qMeta}>Describe your product to see which communities would be read.</p>
        )}
      </div>
      <p className={s.startCta}>
        <Link href="/auth/sign-up" className="btn">
          Create free account
        </Link>
        <Link href="/auth/sign-in" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
