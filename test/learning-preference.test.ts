import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEARNING_CONFIG,
  resolveLearningConfig,
} from "../lib/learning/config";
import { formatLearningReasons, rankWithPreferences } from "../lib/learning/rank";
import {
  buildPreferenceModel,
  findRawContentLeakage,
  intentTermsForDocuments,
  sourceIdsForDocuments,
  topicTermsForDocuments,
} from "../lib/learning/signals";
import {
  decisionForEvent,
  resolveDecision,
  type LearningSample,
  type PreferenceModel,
} from "../lib/learning/types";
import { decideStatus, scoreFeatures } from "../lib/opportunities/features";
import type { OpportunityFeatures } from "../lib/opportunities/types";
import type { NormalizedDocument } from "../lib/pipeline/normalize";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  readFileSync(resolve(root, "test/fixtures/learning-replay.json"), "utf8"),
) as {
  workspaceId: string;
  train: LearningSample[];
  holdout: LearningSample[];
};

const ACTIVE = resolveLearningConfig({}, { enabled: true });

function model(samples: LearningSample[], overrides = {}): PreferenceModel {
  return buildPreferenceModel({
    workspaceId: fixture.workspaceId,
    version: 1,
    samples,
    config: { ...ACTIVE, ...overrides },
  });
}

function weightOf(preferenceModel: PreferenceModel, key: string) {
  return preferenceModel.weights.find((w) => w.key === key);
}

function doc(
  id: string,
  platform: string,
  title: string,
  text: string,
): NormalizedDocument {
  return {
    id,
    workspaceId: "ws-1",
    urlCanonical: `https://example.com/${id}`,
    platform,
    title,
    authorRef: null,
    postedAt: new Date("2026-09-20T12:00:00.000Z"),
    text,
    contentHash: id,
  };
}

const STRONG: OpportunityFeatures = {
  fit: 0.55,
  intent: 0.5,
  evidence: 0.4,
  momentum: 0.45,
  timing: 0.61,
  modelConfidence: 0.7,
  lowConfidence: false,
};

const CRYPTO_CONTEXT = {
  topics: ["crypto", "trading"],
  sourceIds: ["s_crypto_news"],
  intents: ["rung_1"],
};

const OBSERVABILITY_CONTEXT = {
  topics: ["observability", "tracing"],
  sourceIds: ["s_observability"],
  intents: ["rung_4"],
};

describe("conservative per-workspace learning", () => {
  it("changes no ranking below the minimum evidence threshold", () => {
    const preferenceModel = model(fixture.train.slice(0, 5));
    expect(preferenceModel.active).toBe(false);
    expect(preferenceModel.disabledReason).toBe("insufficient_evidence");

    const adjustment = rankWithPreferences({
      features: STRONG,
      status: decideStatus(STRONG),
      model: preferenceModel,
      context: CRYPTO_CONTEXT,
      config: ACTIVE,
    });

    expect(adjustment.active).toBe(false);
    expect(adjustment.score).toBe(scoreFeatures(STRONG));
    expect(adjustment.delta).toBe(0);
    expect(adjustment.reasons).toEqual([]);
  });

  it("activates only once the workspace evidence threshold is met", () => {
    const oneShort = model(fixture.train.slice(0, ACTIVE.minWorkspaceEvidence - 1));
    expect(oneShort.evidence).toBe(ACTIVE.minWorkspaceEvidence - 1);
    expect(oneShort.active).toBe(false);

    const sufficient = model(fixture.train);
    expect(sufficient.evidence).toBe(ACTIVE.minWorkspaceEvidence);
    expect(sufficient.active).toBe(true);
    expect(sufficient.disabledReason).toBeNull();
  });

  it("returns the baseline verbatim when the feature flag is off", () => {
    const active = model(fixture.train);
    expect(active.active).toBe(true);

    const disabled = resolveLearningConfig({});
    expect(disabled.enabled).toBe(false);

    const adjustment = rankWithPreferences({
      features: STRONG,
      status: decideStatus(STRONG),
      model: active,
      context: OBSERVABILITY_CONTEXT,
      config: disabled,
    });

    expect(adjustment.active).toBe(false);
    expect(adjustment.score).toBe(scoreFeatures(STRONG));
    expect(adjustment.delta).toBe(0);
  });

  it("never reclassifies an opportunity, even when the score crosses a threshold", () => {
    const justBelow: OpportunityFeatures = { ...STRONG, timing: 0.13 };
    const baseline = scoreFeatures(justBelow);
    expect(baseline).toBeGreaterThan(0.44);
    expect(baseline).toBeLessThan(0.45);
    expect(decideStatus(justBelow)).toBe("ignore");

    const adjustment = rankWithPreferences({
      features: justBelow,
      status: decideStatus(justBelow),
      model: model(fixture.train),
      context: OBSERVABILITY_CONTEXT,
      config: ACTIVE,
    });

    expect(adjustment.score).toBeGreaterThan(0.45);
    expect(adjustment.status).toBe("ignore");
    expect(adjustment.status).toBe(decideStatus(justBelow));
  });

  it("drops generic rejected topics and lifts repeatedly acted-on sources", () => {
    const preferenceModel = model(fixture.train);

    const rejectedTopic = weightOf(preferenceModel, "topic:crypto")!;
    expect(rejectedTopic.negatives).toBeGreaterThan(rejectedTopic.positives);
    expect(rejectedTopic.weight).toBeLessThan(0);

    const actedOnSource = weightOf(preferenceModel, "source:s_observability")!;
    expect(actedOnSource.positives).toBeGreaterThan(actedOnSource.negatives);
    expect(actedOnSource.weight).toBeGreaterThan(0);

    const actedOnIntent = weightOf(preferenceModel, "intent:rung_4")!;
    expect(actedOnIntent.weight).toBeGreaterThan(0);
  });

  it("gives a key no weight before it clears its own evidence threshold", () => {
    const strict = model(fixture.train, { minKeyEvidence: 20 });
    expect(strict.weights.every((w) => w.weight === 0)).toBe(true);
    expect(strict.disabledReason).toBe("no_signal");

    const signal = strict.weights.find((w) => w.key === "source:s_observability")!;
    expect(signal.evidence).toBeGreaterThan(0);
    expect(signal.weight).toBe(0);
  });

  it("keeps preference weights scoped to the workspace they came from", () => {
    const observed = buildPreferenceModel({
      workspaceId: "ws-crypto",
      version: 1,
      samples: fixture.train.filter((s) => s.decision === "negative"),
      config: ACTIVE,
    });
    const observability = model(fixture.train);

    expect(observed.workspaceId).toBe("ws-crypto");
    expect(weightOf(observability, "source:s_observability")).toBeDefined();
    expect(weightOf(observed, "source:s_observability")).toBeUndefined();
    expect(weightOf(observed, "topic:crypto")).toBeDefined();
    expect(weightOf(observability, "topic:crypto")).toBeDefined();

    const crossed = rankWithPreferences({
      features: STRONG,
      status: decideStatus(STRONG),
      model: observed,
      context: OBSERVABILITY_CONTEXT,
      config: ACTIVE,
    });
    expect(crossed.active).toBe(false);
    expect(crossed.score).toBe(scoreFeatures(STRONG));
  });

  it("explains every adjustment it applies", () => {
    const adjustment = rankWithPreferences({
      features: STRONG,
      status: decideStatus(STRONG),
      model: model(fixture.train),
      context: CRYPTO_CONTEXT,
      config: ACTIVE,
    });

    expect(adjustment.active).toBe(true);
    expect(adjustment.modelVersion).toBe(1);
    expect(adjustment.reasons.length).toBeGreaterThan(0);
    for (const reason of adjustment.reasons) {
      expect(reason.key).toMatch(/^(topic|source|intent):/);
      expect(reason.positives + reason.negatives).toBeGreaterThanOrEqual(
        ACTIVE.minKeyEvidence,
      );
    }

    const note = formatLearningReasons(adjustment.reasons);
    expect(note).toMatch(/topic:crypto|source:s_crypto_news/);
    expect(note).toMatch(/\d+ pos \/ \d+ neg/);
  });

  it("never moves a score further than the configured cap", () => {
    const preferenceModel = model(fixture.train);
    for (const sample of fixture.holdout) {
      const adjustment = rankWithPreferences({
        features: sample.features!,
        status: decideStatus(sample.features!),
        model: preferenceModel,
        context: {
          topics: sample.topics,
          sourceIds: sample.sourceIds,
          intents: sample.intents,
        },
        config: ACTIVE,
      });
      expect(Math.abs(adjustment.delta)).toBeLessThanOrEqual(
        ACTIVE.maxTotalDelta,
      );
      expect(adjustment.score - adjustment.baselineScore).toBeCloseTo(
        adjustment.delta,
        10,
      );
    }
  });

  it("never stores collected content in a preference model", () => {
    const post =
      "Our competitor launched a beta that undercuts most vendors on latency " +
      "and nobody has reviewed the changelog yet";
    const samples: LearningSample[] = [
      {
        opportunityId: "raw-1",
        decision: "negative",
        topics: topicTermsForDocuments([
          doc("raw-1", "reddit", "Latency war heats up", post),
        ]),
        sourceIds: ["s_reddit"],
        intents: ["rung_1"],
      },
    ];

    const preferenceModel = buildPreferenceModel({
      workspaceId: "ws-raw",
      version: 1,
      samples,
      config: ACTIVE,
    });

    const serialized = JSON.stringify(preferenceModel);
    expect(serialized).not.toContain("undercuts most vendors");
    expect(serialized).not.toContain("Our competitor launched");
    expect(findRawContentLeakage(preferenceModel.weights)).toEqual([]);
    for (const weight of preferenceModel.weights) {
      expect(weight.key.length).toBeLessThanOrEqual(40);
    }
  });

  it("refuses a weight payload carrying raw content", () => {
    const violations = findRawContentLeakage([
      { key: "topic:social", dimension: "topic", weight: 0.2, contentMd: "post" },
      { key: "topic:x", dimension: "topic", weight: 0.2, url: "https://x.test/1" },
      {
        key: `topic:${"y".repeat(80)}`,
        dimension: "topic",
        weight: Number.NaN,
      },
    ]);

    expect(violations).toHaveLength(4);
    expect(violations.join(" ")).toMatch(/contentMd/);
    expect(violations.join(" ")).toMatch(/url/);
    expect(violations.join(" ")).toMatch(/exceeds 40 chars/);
    expect(violations.join(" ")).toMatch(/not finite/);
  });

  it("treats conflicting decisions on one opportunity as no signal", () => {
    expect(resolveDecision(["positive", "negative"])).toBe("none");
    expect(resolveDecision(["positive", "positive"])).toBe("positive");
    expect(resolveDecision(["negative"])).toBe("negative");
    expect(resolveDecision([])).toBe("none");

    const conflicted = buildPreferenceModel({
      workspaceId: "ws-conflict",
      version: 1,
      samples: fixture.train.map((s) => ({ ...s, decision: "none" as const })),
      config: ACTIVE,
    });
    expect(conflicted.evidence).toBe(0);
    expect(conflicted.weights).toEqual([]);
  });

  it("never learns from edits or clicks on our own output", () => {
    expect(decisionForEvent("useful")).toBe("positive");
    expect(decisionForEvent("acted_on")).toBe("positive");
    expect(decisionForEvent("rejected")).toBe("negative");
    expect(decisionForEvent("not_useful")).toBe("negative");
    expect(decisionForEvent("draft_edit")).toBe("none");
    expect(decisionForEvent("utm_click")).toBe("none");
  });

  it("extracts generic preference keys from collected documents", () => {
    const docs = [
      doc("a", "reddit", "Looking for a social listening tool", "Need brand monitoring"),
      doc("b", "hn", "Social listening recommendations", "Anyone recommend a social listening tool"),
    ];

    const topics = topicTermsForDocuments(docs);
    expect(topics).toContain("social");
    expect(topics).toContain("listening");
    expect(topics).not.toContain("looking");

    expect(intentTermsForDocuments(docs)).toContain("rung_4");
    expect(
      sourceIdsForDocuments(docs, new Map([["a", "s_a"], ["b", "s_a"]])),
    ).toEqual(["s_a"]);
  });

  it("documents the rollout flags and defaults them off", () => {
    const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
    for (const flag of [
      "VANTAGE_LEARNING_ENABLED",
      "VANTAGE_LEARNING_MIN_EVIDENCE",
      "VANTAGE_LEARNING_MIN_KEY_EVIDENCE",
      "VANTAGE_LEARNING_MAX_DELTA",
      "VANTAGE_LEARNING_MAX_WEIGHT",
      "VANTAGE_LEARNING_MAX_RANK_SHIFT",
    ]) {
      expect(envExample).toContain(flag);
    }
    expect(DEFAULT_LEARNING_CONFIG.enabled).toBe(false);
  });

  it("clamps malformed rollout configuration to conservative values", () => {
    const config = resolveLearningConfig({
      VANTAGE_LEARNING_ENABLED: "true",
      VANTAGE_LEARNING_MAX_DELTA: "999",
      VANTAGE_LEARNING_MIN_EVIDENCE: "not-a-number",
      VANTAGE_LEARNING_MAX_RANK_SHIFT: "-4",
      VANTAGE_LEARNING_MAX_WEIGHT: "",
    });

    expect(config.enabled).toBe(true);
    expect(config.maxTotalDelta).toBe(1);
    expect(config.minWorkspaceEvidence).toBe(
      DEFAULT_LEARNING_CONFIG.minWorkspaceEvidence,
    );
    expect(config.maxRankShift).toBe(0);
    expect(config.maxAbsWeight).toBe(DEFAULT_LEARNING_CONFIG.maxAbsWeight);
  });
});