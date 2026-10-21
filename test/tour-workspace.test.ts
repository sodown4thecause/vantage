import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEMO, DEMO_LANES, demoReply } from "@/app/tour/tour-demo";

describe("guided sample workspace", () => {
  it("provides the workspace sections and labels future workflows as previews", () => {
    expect(DEMO_LANES.map((lane) => lane.label)).toEqual(["GTM", "SEO", "GEO", "Content"]);
    expect(DEMO_LANES.filter((lane) => lane.preview).map((lane) => lane.id)).toEqual(["seo", "geo", "content"]);
    for (const lane of DEMO_LANES.filter((item) => item.preview)) {
      expect(DEMO[lane.id].introduction).toMatch(/preview/i);
    }
  });

  it("offers exactly three deterministic actions per section with matching sample evidence", () => {
    for (const lane of DEMO_LANES) {
      expect(DEMO[lane.id].actions).toHaveLength(3);
      expect(new Set(DEMO[lane.id].actions.map((action) => action.answer)).size).toBe(3);
      for (const action of DEMO[lane.id].actions) {
        expect(demoReply(lane.id, action.prompt)).toEqual({ answer: action.answer, evidence: action.evidence });
        expect(action.evidence.length).toBeGreaterThan(0);
        expect(action.evidence.every((item) => item.source.startsWith("Sample ·"))).toBe(true);
      }
    }
    expect(demoReply("gtm", DEMO.gtm.actions[0].prompt).evidence).not.toEqual(demoReply("gtm", DEMO.gtm.actions[1].prompt).evidence);
    expect(DEMO.gtm.actions[1].evidence[0].title).toBe("What do you use to trace tool calls in production agents?");
  });

  it("answers arbitrary input with an honest demo boundary, not invented research", () => {
    for (const lane of DEMO_LANES) {
      const reply = demoReply(lane.id, "Find new customers for my company right now");
      expect(reply.answer).toContain("not a live assistant");
      expect(reply.answer).toContain("not sent to a model or an external service");
      expect(reply.answer).toContain("previews, not live capabilities");
      expect(reply.evidence).toEqual(DEMO[lane.id].evidence);
    }
  });

  it("uses the shared frame and composer without a scrolling engine or network calls", () => {
    const source = readFileSync("app/tour/tour-surface.tsx", "utf8");
    expect(source).toContain("<WorkspaceFrame focused demo");
    expect(source).toContain("../workspace/workspace.module.css");
    expect(source).toContain("<textarea");
    expect(source).toContain("<details className={s.mobileEvidence}");
    expect(source).toContain('index === 0 && <span className={s.recommended}>Recommended</span>');
    expect(source).not.toMatch(/scrollcraft|fetch\(|requestAnimationFrame|addEventListener/);
    expect(source).toContain('href="/auth/sign-up"');
    expect(source).toContain('href="/"');
  });
});
