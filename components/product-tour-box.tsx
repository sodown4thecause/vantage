"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { pickForumDomains } from "@/lib/communities/forum-packs";
import { HeroExamples } from "@/components/hero-examples";
import type { PublicHeroExample } from "@/lib/public/hero-examples";
import styles from "@/app/home.module.css";

type Turnstile = {
  render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function turnstile(): Turnstile | undefined {
  return (window as Window & { turnstile?: Turnstile }).turnstile;
}

export function ProductTourBox() {
  const [product, setProduct] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [examples, setExamples] = useState<PublicHeroExample[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const forums = product.trim().length >= 3 ? pickForumDomains(product).slice(0, 8) : [];

  const mountWidget = useCallback(() => {
    if (!container.current || !sitekey || widget.current !== undefined) return;
    widget.current = turnstile()?.render(container.current, {
      sitekey,
      callback: setToken,
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
  }, [sitekey]);

  useEffect(() => {
    mountWidget();
    return () => {
      if (widget.current !== undefined) turnstile()?.remove(widget.current);
      widget.current = undefined;
      setToken("");
    };
  }, [mountWidget]);

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || state === "saving") return;
    setState("saving");
    try {
      const response = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-turnstile-token": token },
        body: JSON.stringify({ product, email }),
      });
      if (!response.ok) throw new Error("capture_failed");
      const result: { examples: PublicHeroExample[] } = await response.json();
      setExamples(result.examples);
      setState("saved");
    } catch {
      setState("error");
    } finally {
      setToken("");
      if (widget.current !== undefined) turnstile()?.reset(widget.current);
    }
  }

  return <div className={styles.tourBox}>
    <label htmlFor="tour-product">What do you build?</label>
    <p>Describe your product and who it helps.</p>
    <textarea id="tour-product" rows={3} maxLength={2000} value={product} disabled={state === "saving" || state === "saved"} onChange={(event) => setProduct(event.target.value)} placeholder="An open-source SDK for developers debugging AI agents" />
    <div aria-live="polite">
      {forums.length ? <>
        <p className={styles.badge}>Coverage preview · no live scan</p>
        <p>Your workspace could explore Reddit, Hacker News, X, GitHub, Stack Overflow and these forums:</p>
        <ul className={styles.forums}>{forums.map((forum) => <li key={forum}>{forum}</li>)}</ul>
        <p>Suggested sources, not confirmed coverage. Availability depends on access and your plan.</p>
      </> : <p>Enter a few words to preview relevant communities. Nothing is sent until you submit the email form.</p>}
    </div>
    <form onSubmit={capture} className={styles.leadForm}>
      <h2>See what a useful conversation looks like</h2>
      <p>Save your interest to see up to three approved examples, when available. We save your email and product description. No scan runs and nothing is sent.</p>
      {state === "saved" ? <p role="status">Your interest is saved. We haven’t sent you anything.</p> : <>
        <label htmlFor="lead-email">Email address</label>
        <input id="lead-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={state === "saving"} onChange={(event) => setEmail(event.target.value)} />
        <div ref={container} />
        {!sitekey && <p role="status">Email capture is temporarily unavailable. You can still start a free workspace.</p>}
        <button className={styles.primary} disabled={!token || product.trim().length < 3 || state === "saving"}>{state === "saving" ? "Saving…" : "Save my interest"}</button>
        {state === "error" && <p role="alert">We couldn’t save your interest. Please complete the check and try again.</p>}
      </>}
    </form>
    <HeroExamples examples={examples} />
    {sitekey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={mountWidget} />}
  </div>;
}
