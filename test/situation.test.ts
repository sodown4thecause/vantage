import { describe, expect, it } from "vitest";
import {
  classifySituation,
  freshnessFor,
  type Situation,
} from "@/lib/pipeline/situation";

const NOW = new Date("2026-10-07T00:00:00Z");
const doc = (text: string, postedAt: Date | null = null) => ({
  id: "d1",
  title: "",
  text,
  postedAt,
});

describe("classifySituation", () => {
  const cases: Array<[string, Situation]> = [
    ["We are migrating away from Datadog", "migration"],
    ["Honestly it's getting expensive for a small team", "price_pain"],
    ["Cursor just removed the feature we relied on", "breakage"],
    ["Evaluating Langfuse vs Helicone vs Phoenix", "evaluation"],
    ["Open-source alternative to LangSmith?", "alternative_request"],
    ["Is there a free tier or trial?", "free_tier_request"],
    ["Does anything integrate Linear with GitHub issues?", "integration_gap"],
    ["I built this myself because nothing exists", "built_it_myself"],
    ["Our team needs an eval harness", "team_need"],
    ["Anyone running this in production?", "production_check"],
    ["What tool can trace LLM calls?", "tool_request"],
    ["How do people handle prompt versioning?", "how_solved"],
    ["Lovely weather today", "other"],
  ];
  it.each(cases)("%s -> %s", (text, expected) => {
    expect(classifySituation(doc(text), NOW).situation).toBe(expected);
  });

  it("reports secondary matches", () => {
    const r = classifySituation(doc("Alternative to X, it's too expensive"), NOW);
    expect(r.situation).toBe("price_pain");
    expect(r.secondary).toContain("alternative_request");
  });

  it("scores noise below intent situations", () => {
    expect(classifySituation(doc("hello"), NOW).score).toBeLessThan(
      classifySituation(doc("migrating away from X"), NOW).score,
    );
  });
});

describe("freshnessFor", () => {
  it("halves at the half-life", () => {
    const posted = new Date(NOW.getTime() - 2 * 86_400_000);
    expect(freshnessFor("breakage", posted, NOW)).toBeCloseTo(0.5, 5);
  });
  it("decays breakage faster than how_solved", () => {
    const posted = new Date(NOW.getTime() - 4 * 86_400_000);
    expect(freshnessFor("breakage", posted, NOW)).toBeLessThan(
      freshnessFor("how_solved", posted, NOW),
    );
  });
  it("is 1 when the date is unknown or in the future", () => {
    expect(freshnessFor("breakage", null, NOW)).toBe(1);
    expect(freshnessFor("breakage", new Date(NOW.getTime() + 1e6), NOW)).toBe(1);
  });
});
