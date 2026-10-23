"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { WorkspaceFrame } from "@/components/workspace-frame";

import { DEMO, DEMO_LANES, demoReply, type DemoEvidence, type DemoLane, type DemoTurn } from "./tour-demo";
import { WORKSPACE } from "./tour-data";
import s from "@/app/workspace/workspace.module.css";
import t from "./tour.module.css";

function Evidence({ items }: { items: DemoEvidence[] }) {
  return <>
    <div className={s.evidenceHead}><h2>Behind the sample answer</h2><span>{items.length}</span></div>
    <p className={s.evidenceIntro}>Illustrative evidence only. These are not live posts, connected accounts, or measured results.</p>
    {items.map((item) => <article className={s.opportunity} key={`${item.source}-${item.title}`}>
      <div className={s.source}>{item.source}</div>
      <h3>{item.title}</h3><blockquote>{item.text}</blockquote>
    </article>)}
  </>;
}

export function TourSurface() {
  const [lane, setLane] = useState<DemoLane>("gtm");
  const [turns, setTurns] = useState<DemoTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [evidence, setEvidence] = useState(DEMO.gtm.evidence);
  const scroll = useRef<HTMLDivElement>(null);
  const current = DEMO[lane];
  const label = DEMO_LANES.find((item) => item.id === lane)!.label;

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
  }, [turns, lane]);

  function selectLane(next: DemoLane) {
    setLane(next);
    setTurns([]);
    setDraft("");
    setEvidence(DEMO[next].evidence);
  }

  function send(message: string) {
    const prompt = message.trim();
    if (!prompt) return;
    const reply = demoReply(lane, prompt);
    setTurns((previous) => [...previous, { role: "user", content: prompt }, { role: "assistant", content: reply.answer }]);
    setEvidence(reply.evidence);
    setDraft("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  return <WorkspaceFrame focused demo active={lane === "gtm" ? "workspace" : lane} title={label} subtitle={`${WORKSPACE} · Sample`}
    navigation={<nav className={s.nav} aria-label="Sample workspace sections">{DEMO_LANES.map((item) => <button type="button" key={item.id} aria-current={lane === item.id ? "page" : undefined} onClick={() => selectLane(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.preview && <small>Preview</small>}</button>)}</nav>}
    tools={<div className={t.sampleNote}><strong>{WORKSPACE}</strong><p>Fictional product. Sample data.</p><button type="button" onClick={() => selectLane(lane)}>＋ Restart sample conversation</button></div>}
    setup={<section className={s.setup} aria-label="About this demo"><h2>A guided sample</h2><p>No live searches. No model calls. Nothing is posted.</p><Link href="/auth/sign-up">Try your own workspace →</Link><Link href="/">Back to home</Link></section>}>
    <div className={s.body}>
      <section className={s.conversation} aria-label={`${label} sample conversation`}>
        <div className={s.scroll} ref={scroll}>
          {turns.length === 0 ? <div className={s.intro}>
            <div className={s.eyebrow}><span className={s.spark} aria-hidden="true">✳</span>{lane === "gtm" ? "An interactive sample workspace" : `${label} workflow preview`}</div>
            <h1>{current.heading}</h1><p>{current.introduction}</p>
            <div className={s.context}><span>Sample data</span><span>No live assistant</span><span>You stay in control</span></div>
          </div> : <ol className={s.turns} aria-label="Sample conversation">{turns.map((turn, index) => <li className={s.turn} key={index}>{turn.role === "user" ? <p className={s.user}>{turn.content}</p> : <><div className={s.turnLabel}><span className={s.spark} aria-hidden="true">✳</span>{label} · Prewritten sample answer</div><div className={s.answer}>{turn.content}</div></>}</li>)}</ol>}
          <p className={t.status} role="status" aria-live="polite">{turns.length > 0 ? "Sample answer ready. Supporting sample evidence updated." : `${label} sample selected. Choose a suggested next action.`}</p>
          <details className={s.mobileEvidence}><summary>View sample evidence ({evidence.length})</summary><div className={t.mobileEvidence}><Evidence items={evidence} /></div></details>
        </div>
        <div className={s.dock}>
          <div className={s.nextLabel}><span>Your next move</span><span>Three ways to explore</span></div>
          <div className={s.actions} role="group" aria-label="Recommended next actions">{current.actions.map((action, index) => <button type="button" className={s.action} key={action.prompt} onClick={() => send(action.prompt)}><span className={s.actionNumber}>0{index + 1}</span><span><strong>{action.prompt}</strong>{index === 0 && <span className={s.recommended}>Recommended</span>}<small>{action.reason}</small></span><span aria-hidden="true">↗</span></button>)}</div>
          <form className={s.composer} onSubmit={onSubmit} aria-label="Explore the guided demo">
            <label htmlFor="tour-message" className="sr-only">Your sample message</label>
            <textarea id="tour-message" rows={2} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about the demo, or choose a next move above…" aria-describedby="tour-disclaimer" />
            <div className={s.composerFooter}><span>Guided demo · No model connected</span><button type="submit" className={s.send} disabled={!draft.trim()} aria-label="Send sample message">↑</button></div>
          </form>
          <p className={s.disclaimer} id="tour-disclaimer">Prewritten examples, not live answers. <Link className={t.signup} href="/auth/sign-up">Create your workspace →</Link></p>
        </div>
      </section>
      <aside className={s.evidence} aria-label="Supporting sample evidence"><Evidence items={evidence} /></aside>
    </div>
  </WorkspaceFrame>;
}
