import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveLearningConfig } from "../lib/learning/config";
import { evaluateReplay, replayMetrics } from "../lib/learning/evaluate";
import type {
  EvaluationGate,
  LearningSample,
} from "../lib/learning/types";
import { scoreFeatures } from "../lib/opportunities/features";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  readFileSync(resolve(root, "test/fixtures/learning-replay.json"), "utf8"),
) as {
  workspaceId: string;
  description: string;
  config: { enabled: boolean };
  train: LearningSample[];
  holdout: LearningSample[];
};

const REPLAY = {
  train: fixture.train,
  holdout: fixture.holdout,
  workspaceId: fixture.workspaceId,
  config: fixture.config,
};

function gate(report: { gates: EvaluationGate[] }, name: string) {
  const found = report.gates.find((g) => g.name === name);
  if (!found) throw new Error(`missing gate ${name}`);
  return found;
}

function repeat(
  prefix: string,
  decision: "positive" | "negative",
  terms: Partial<LearningSample>,
  count: number,
): LearningSample[] {
  return Array.from({ length: count }, (_, i) => ({
    opportunityId: `${prefix}-${i}`,
    decision,
    topics: [],
    sourceIds: [],
    intents: [],
    ...terms,
  }));
}

function scored(
  opportunityId: string,
  decision: "positive" | "negative",
  topic: string,
  sourceId: string,
  timing: number,
): LearningSample {
  return {
    opportunityId,
    decision,
    topics: [topic],
    sourceIds: [sourceId],
    intents: ["rung_2"],
    features: {
      fit: 0.55,
      intent: 0.5,
      evidence: 0.4,
      momentum: 0.45,
      timing,
      modelConfidence: 0.7,
      lowConfidence: false,
    },
  };
}

describe("offline baseline-vs-learned evaluation", () => {
  it("reports inactive below the evidence threshold", () => {
    const report = evaluateReplay({
      train: fixture.train.slice(0, 4),
      holdout: fixture.holdout,
      workspaceId: fixture.workspaceId,
      config: fixture.config,
    });

    expect(report.verdict).toBe("inactive");
    expect(report.inactiveReason).toBe("insufficient_evidence");
    expect(gate(report, "evidence_sufficient").passed).toBe(false);
    expect(report.improvement.ndcg).toBe(0);
    expect(report.learned).toEqual(report.baseline);
    expect(report.stability.maxScoreDelta).toBe(0);
  });

  it("reports inactive while the feature flag is off", () => {
    const report = evaluateReplay({
      train: fixture.train,
      holdout: fixture.holdout,
      workspaceId: fixture.workspaceId,
    });

    expect(report.verdict).toBe("inactive");
    expect(report.inactiveReason).toBe("flag_disabled");
    expect(report.model.evidence).toBe(fixture.train.length);
    expect(report.learned).toEqual(report.baseline);
  });

  it("measures an offline improvement against the deterministic baseline", () => {
    const report = evaluateReplay(REPLAY);

    expect(report.verdict).toBe("improves");
    expect(report.inactiveReason).toBeNull();
    expect(report.baseline.ndcg).toBeGreaterThan(0);
    expect(report.learned.ndcg).toBeGreaterThan(report.baseline.ndcg);
    expect(report.learned.mrr).toBeGreaterThan(report.baseline.mrr);
    expect(report.learned.precision).toBeGreaterThan(report.baseline.precision);
    expect(report.improvement.ndcg).toBeGreaterThan(0);

    for (const name of [
      "deterministic_baseline",
      "train_holdout_separation",
      "no_status_change",
      "bounded_score_delta",
      "bounded_rank_shift",
      "ndcg_not_worse",
    ]) {
      expect(gate(report, name).passed, name).toBe(true);
    }
  });

  it("keeps the queue ordered the way the workspace decided", () => {
    const report = evaluateReplay(REPLAY);
    expect(report.baseline.precision).toBeCloseTo(0.4, 6);
    expect(report.learned.precision).toBeCloseTo(0.6, 6);
    expect(report.baseline.mrr).toBeCloseTo(0.25, 6);
    expect(report.learned.mrr).toBeCloseTo(1, 6);
  });

  it("never lets holdout labels enter the weights being measured", () => {
    const report = evaluateReplay(REPLAY);
    const scored = fixture.train.filter((s) => s.decision !== "none");

    expect(report.model.evidence).toBe(scored.length);
    expect(report.model.evidence).toBe(fixture.train.length);
    expect(gate(report, "train_holdout_separation").passed).toBe(true);
    expect(report.model.workspaceId).toBe(fixture.workspaceId);
  });

  it("never reclassifies a candidate during replay", () => {
    const report = evaluateReplay(REPLAY);
    expect(report.stability.statusFlips).toBe(0);
    expect(gate(report, "no_status_change").detail).toContain("0 status");
  });

  it("bounds both the score delta and the rank displacement", () => {
    const config = resolveLearningConfig({}, { enabled: true });
    const report = evaluateReplay(REPLAY);

    expect(report.stability.maxScoreDelta).toBeLessThanOrEqual(
      config.maxTotalDelta,
    );
    expect(report.stability.maxRankShift).toBeLessThanOrEqual(config.maxRankShift);
  });

  it("blocks enablement when learning reorders past the stability tolerance", () => {
    const report = evaluateReplay({ ...REPLAY, config: { enabled: true, maxRankShift: 1 } });

    expect(report.verdict).toBe("regression_blocked");
    expect(gate(report, "bounded_rank_shift").passed).toBe(false);
    expect(report.stability.maxRankShift).toBeGreaterThan(1);
  });

  it("blocks enablement when learned ranking is worse than the baseline", () => {
    // Relevant items start above irrelevant ones, so penalising the group the
    // workspace actually acted on has to degrade NDCG.
    const holdout: LearningSample[] = [
      scored("p1", "positive", "observability", "s_observability", 0.85),
      scored("p2", "positive", "observability", "s_observability", 0.75),
      scored("p3", "positive", "observability", "s_observability", 0.65),
      scored("n1", "negative", "crypto", "s_crypto_news", 0.55),
      scored("n2", "negative", "crypto", "s_crypto_news", 0.45),
    ];

    const inverted: LearningSample[] = [
      ...repeat(
        "neg",
        "negative",
        { topics: ["observability"], sourceIds: ["s_observability"] },
        10,
      ),
      ...repeat(
        "pos",
        "positive",
        { topics: ["crypto"], sourceIds: ["s_crypto_news"] },
        10,
      ),
    ];

    const report = evaluateReplay({
      train: inverted,
      holdout,
      workspaceId: "ws-inverted",
      config: { enabled: true, maxTotalDelta: 0.5, maxRankShift: 20 },
    });

    expect(report.baseline.ndcg).toBe(1);
    expect(report.learned.ndcg).toBeLessThan(report.baseline.ndcg);
    expect(report.learned.mrr).toBeLessThan(report.baseline.mrr);
    expect(report.verdict).toBe("regression_blocked");
    expect(gate(report, "ndcg_not_worse").passed).toBe(false);
    expect(gate(report, "bounded_score_delta").passed).toBe(true);
    expect(report.stability.maxRankShift).toBeGreaterThan(0);
  });

  it("produces the same report for the same fixture", () => {
    const first = evaluateReplay(REPLAY);
    const second = evaluateReplay(REPLAY);

    expect(second.verdict).toBe(first.verdict);
    expect(second.learned).toEqual(first.learned);
    expect(second.baseline).toEqual(first.baseline);
    expect(second.stability).toEqual(first.stability);
  });

  it("scores an empty relevant set to zero rather than dividing by zero", () => {
    expect(replayMetrics(["a", "b"], new Set(), 5)).toEqual({
      ndcg: 0,
      precision: 0,
      mrr: 0,
    });
  });

  it("matches an independently computed baseline ranking", () => {
    const report = evaluateReplay({ ...REPLAY, config: { enabled: false } });

    const ranked = [...fixture.holdout]
      .map((s) => ({ id: s.opportunityId, score: scoreFeatures(s.features!) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((s) => s.id);
    const relevant = new Set(
      fixture.holdout.filter((s) => s.decision === "positive").map((s) => s.opportunityId),
    );

    expect(report.baseline).toEqual(replayMetrics(ranked, relevant, report.k));
  });

  it("reads the same configuration production will apply", () => {
    const strict = evaluateReplay({
      ...REPLAY,
      env: { VANTAGE_LEARNING_MAX_DELTA: "0" },
    });
    // A deploy-time cap of 0 disables the nudge entirely.
    expect(strict.stability.maxScoreDelta).toBe(0);
    expect(strict.learned).toEqual(strict.baseline);
  });

  it("blocks a delta that exceeds the configured cap", () => {
    const report = evaluateReplay({
      ...REPLAY,
      env: {},
      config: { enabled: true, maxTotalDelta: 0.01 },
    });

    // The clamp must engage and hold, not merely be reported as passing.
    const gate = report.gates.find((g) => g.name === "bounded_score_delta")!;
    expect(gate.passed).toBe(true);
    expect(gate.detail).toContain("0 failure(s)");
    expect(report.stability.maxScoreDelta).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("detects a holdout label leaking into the weights", () => {
    // Train on train+holdout: observation count must exceed what train alone
    // contributes. This is the failure train_holdout_separation exists to catch.
    const leaky = evaluateReplay({ ...REPLAY, train: [...fixture.train, ...fixture.holdout] });
    const clean = evaluateReplay(REPLAY);

    const count = (r: typeof clean) => r.model.weights.reduce((n, w) => n + w.evidence, 0);
    expect(count(leaky)).toBeGreaterThan(count(clean));

    // And the gate itself is falsifiable: it compares two independent counts.
    expect(
      clean.gates.find((g) => g.name === "train_holdout_separation")!.detail,
    ).toContain(`model attributes ${count(clean)} observations`);
  });
});