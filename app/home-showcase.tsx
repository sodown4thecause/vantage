"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { GLYPH_AXES, Glyph, Mark } from "@/components/glyph";
import { EVIDENCE, QUEUE, WHY_RANKED } from "@/app/tour/tour-data";

import styles from "./home-showcase.module.css";

const VIEWS = [
  { id: "gtm", label: "GTM workspace" },
  { id: "evidence", label: "Evidence" },
  { id: "seo", label: "SEO + GEO" },
  { id: "digest", label: "Daily digest" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

const SEARCH_QUESTIONS = [
  ["SEO", "What keywords should a new developer tool target first?"],
  ["GEO", "How do AI assistants decide which tools to recommend?"],
  ["Content", "What blog topics bring developer tools signups?"],
] as const;

function ViewContent({ view }: { view: ViewId }) {
  const top = QUEUE[0]!;

  if (view === "gtm") {
    return (
      <div className={styles.workspaceView}>
        <div className={styles.queue}>
          <p className={styles.sectionLabel}>Opportunities · sample</p>
          <h2>Worth a closer look</h2>
          <ol>
            {QUEUE.slice(0, 3).map((item, index) => (
              <li key={item.title} className={index === 0 ? styles.selectedQueueItem : undefined}>
                <span className={styles.queueSource}>{item.source}</span>
                <span>{item.title}</span>
              </li>
            ))}
          </ol>
        </div>
        <article className={styles.opportunity}>
          <p className={styles.meta}>{top.source} <span>{top.where}</span><span>{top.age} ago</span></p>
          <h2>{top.title}</h2>
          <blockquote>{EVIDENCE[0]!.text}</blockquote>
          <div className={styles.scoreBreakdown}>
            <Glyph features={top.features} size={116} />
            <dl>
              {GLYPH_AXES.map((axis) => (
                <div key={axis}>
                  <dt>{axis}</dt>
                  <dd>{Math.round(top.features[axis] * 100)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className={styles.finePrint}>Example from the Tracewell demo workspace. Not a live lead.</p>
        </article>
      </div>
    );
  }

  if (view === "evidence") {
    return (
      <div className={styles.evidenceView}>
        <div className={styles.evidenceIntro}>
          <p className={styles.sectionLabel}>Linked conversations · sample</p>
          <h2>One problem, seen in more than one place.</h2>
          <p>Read the source posts and decide for yourself whether the signal is worth acting on.</p>
        </div>
        <ol className={styles.evidenceList}>
          {EVIDENCE.map((item) => (
            <li key={`${item.source}-${item.who}`}>
              <p>{item.source} <span>{item.who}</span></p>
              <blockquote>{item.text}</blockquote>
            </li>
          ))}
        </ol>
        <aside className={styles.rankedBecause}>
          <h3>Why it ranked</h3>
          <ul>{WHY_RANKED.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </aside>
        <p className={styles.finePrint}>Illustrative posts from the Tracewell demo workspace, not real people or leads.</p>
      </div>
    );
  }

  if (view === "seo") {
    return (
      <div className={styles.seoView}>
        <div className={styles.seoIntro}>
          <p className={styles.sectionLabel}>Search research</p>
          <h2>Ask about search, AI answers, and content.</h2>
          <p>Explore a question, see the research plan, and approve paid lookups before they run.</p>
        </div>
        <ul className={styles.questionList}>
          {SEARCH_QUESTIONS.map(([category, question]) => (
            <li key={category}>
              <span>{category}</span>
              <p>{question}</p>
              <span aria-hidden="true">↗</span>
            </li>
          ))}
        </ul>
        <p className={styles.finePrint}>Example prompts only. No search or answer-engine data is queried in this preview.</p>
      </div>
    );
  }

  return (
    <div className={styles.digestView}>
      <div className={styles.digestMeta}>
        <p className={styles.sectionLabel}>A sample email</p>
        <span>Daily digest</span>
      </div>
      <article className={styles.email}>
        <div className={styles.emailBrand}><Mark size={18} /><span>contextfor.dev</span><span>GTM</span></div>
        <p className={styles.greeting}>Good morning, Tracewell</p>
        <h2>Three conversations to start with.</h2>
        <p className={styles.emailIntro}>A short list, ranked with the evidence behind it. Your reply is always yours.</p>
        <ol>
          {QUEUE.slice(0, 3).map((item, index) => (
            <li key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{item.title}</strong><small>{item.source} · {item.where}</small></div>
            </li>
          ))}
        </ol>
        <p className={styles.emailNote}>Up to five conversations a day. Fewer when fewer clear the bar.</p>
      </article>
      <p className={styles.finePrint}>Illustrative email using demo data. Digest timing is set in your workspace.</p>
    </div>
  );
}

export function HomeShowcase() {
  const [active, setActive] = useState<ViewId>("gtm");
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = VIEWS.findIndex((view) => view.id === active);
  const selected = VIEWS[selectedIndex]!;

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight"
      ? (index + 1) % VIEWS.length
      : event.key === "ArrowLeft"
        ? (index - 1 + VIEWS.length) % VIEWS.length
        : -1;
    if (next < 0) return;
    event.preventDefault();
    const view = VIEWS[next]!;
    setActive(view.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <figure className={styles.showcase} aria-describedby={`${id}-note`}>
      <figcaption className={styles.caption}>
        <span><i aria-hidden="true" />Inside a GTM workspace</span>
        <span>Tracewell · sample data</span>
      </figcaption>
      <div className={styles.slab}>
        <svg className={styles.contours} viewBox="0 0 760 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M-40 84C65 25 149 16 222 54s121 66 210 39 164-8 205 36 82 47 171 16" />
            <path d="M-48 106C60 48 145 39 217 75s120 66 211 39 165-9 207 33 81 46 170 17" />
            <path d="M-52 130C56 72 139 64 211 98s122 65 215 38 166-9 208 31 80 46 170 18" />
            <path d="M-58 154C48 98 134 89 206 122s124 64 218 37 166-9 208 30 80 44 171 19" />
            <path d="M-66 180C39 125 127 115 201 147s126 62 221 35 166-8 210 29 81 44 172 20" />
            <path d="M-80 426C18 367 107 358 181 392s129 62 226 35 169-5 212 34 84 42 176 16" />
            <path d="M-86 452C14 394 102 385 177 417s130 63 227 36 170-5 214 33 84 41 176 17" />
            <path d="M-92 478C9 420 98 411 173 443s132 62 229 35 171-4 216 32 84 41 176 18" />
            <path d="M574-30C511 48 511 102 563 154s63 101 15 149-47 89 8 141 61 93 7 149" />
            <path d="M598-36C537 42 537 98 586 151s61 101 14 148-46 89 8 139 59 93 7 150" />
            <path d="M622-42C563 36 562 94 610 148s58 101 12 148-45 88 7 139 58 93 7 150" />
          </g>
        </svg>
        <div className={styles.window}>
          <header className={styles.windowHeader}>
            <div className={styles.windowBrand}><Mark size={18} /><span>contextfor.dev</span><span className={styles.slash}>/</span><span>Tracewell</span></div>
            <span className={styles.sampleBadge}>DEMO</span>
          </header>
          <div className={styles.tabList} role="tablist" aria-label="Product preview">
            {VIEWS.map((view, index) => {
              const tabId = `${id}-${view.id}-tab`;
              const panelId = `${id}-${view.id}-panel`;
              return (
                <button
                  key={view.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  id={tabId}
                  type="button"
                  role="tab"
                  aria-selected={active === view.id}
                  aria-controls={panelId}
                  tabIndex={active === view.id ? 0 : -1}
                  onClick={() => setActive(view.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
          <div
            key={selected.id}
            id={`${id}-${selected.id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-${selected.id}-tab`}
            tabIndex={0}
            className={styles.panel}
          >
            <ViewContent view={active} />
          </div>
        </div>
      </div>
      <p id={`${id}-note`} className={styles.note}>A guided preview. Sample data only; nothing here is a live lead.</p>
    </figure>
  );
}
