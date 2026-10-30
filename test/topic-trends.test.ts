import { describe, expect, it } from "vitest";

import { docMatchesTopic, countTopicMentions } from "@/lib/trends/volume";
import {
  MIN_WINDOW_MENTIONS,
  wowChange,
  wowToMomentum,
} from "@/lib/trends/momentum";

const doc = (overrides: Partial<Parameters<typeof countTopicMentions>[0][number]> = {}) => ({
  platform: "reddit",
  postedAt: new Date("2026-10-24T09:00:00Z"),
  collectedAt: new Date("2026-10-25T00:00:00Z"),
  title: null,
  contentMd: "",
  ...overrides,
});

describe("countTopicMentions", () => {
  it("matches topics on word boundaries, case-insensitively", () => {
    expect(docMatchesTopic(doc({ contentMd: "Looking for a CRM tool" }), "CRM")).toBe(true);
    expect(docMatchesTopic(doc({ contentMd: "scrumaster role" }), "CRM")).toBe(false);
    expect(docMatchesTopic(doc({ contentMd: "" }), "CRM")).toBe(false);
  });

  it("counts every matched document, bucketed by topic, source and day", () => {
    const rows = countTopicMentions([
      doc({ contentMd: "crm pricing question", platform: "reddit", postedAt: new Date("2026-10-24T01:00:00Z") }),
      doc({ contentMd: "another crm thread", platform: "hn", postedAt: new Date("2026-10-24T22:00:00Z") }),
      doc({ contentMd: "unrelated", postedAt: new Date("2026-10-24T12:00:00Z") }),
      doc({ contentMd: "crm again", platform: "reddit", postedAt: new Date("2026-10-25T03:00:00Z") }),
    ], ["CRM"]);
    expect(rows).toEqual([
      { topic: "CRM", source: "reddit", day: "2026-10-24", mentions: 1 },
      { topic: "CRM", source: "hn", day: "2026-10-24", mentions: 1 },
      { topic: "CRM", source: "reddit", day: "2026-10-25", mentions: 1 },
    ]);
  });

  it("uses the posted day, falling back to the collected day", () => {
    const rows = countTopicMentions([
      doc({ contentMd: "crm", postedAt: null, collectedAt: new Date("2026-10-20T00:30:00Z") }),
    ], ["crm"]);
    expect(rows[0]?.day).toBe("2026-10-20");
  });

  it("counts a document once per matching topic", () => {
    const rows = countTopicMentions([
      doc({ contentMd: "both crm and seo mentioned" }),
    ], ["CRM", "SEO"]);
    expect(rows.map((r) => r.topic).sort()).toEqual(["CRM", "SEO"]);
    expect(rows.every((r) => r.mentions === 1)).toBe(true);
  });
});

describe("wowChange", () => {
  it("returns a percentage when both windows clear the minimum", () => {
    const wow = wowChange(10, 5);
    expect(wow.status).toBe("ok");
    expect(wow.changePct).toBeCloseTo(100);
  });

  it("guards against low volume in either window", () => {
    expect(wowChange(MIN_WINDOW_MENTIONS - 1, 10).status).toBe("insufficient");
    expect(wowChange(10, MIN_WINDOW_MENTIONS - 1).status).toBe("insufficient");
    expect(wowChange(MIN_WINDOW_MENTIONS - 1, 10).changePct).toBeNull();
  });

  it("handles a falling topic and a zero previous window", () => {
    expect(wowChange(5, 10).changePct).toBeCloseTo(-50);
    expect(wowChange(5, 0).status).toBe("insufficient");
  });

  it("treats the boundary as enough data", () => {
    expect(wowChange(MIN_WINDOW_MENTIONS, MIN_WINDOW_MENTIONS).status).toBe("ok");
  });
});

describe("wowToMomentum", () => {
  it("maps 0% to 0.5, +100% to 1 and -100% to 0", () => {
    expect(wowToMomentum({ current: 5, previous: 5, changePct: 0, status: "ok" })).toBe(0.5);
    expect(wowToMomentum({ current: 10, previous: 5, changePct: 100, status: "ok" })).toBe(1);
    expect(wowToMomentum({ current: 5, previous: 10, changePct: -50, status: "ok" })).toBe(0.25);
  });

  it("returns null when there is not enough data", () => {
    expect(wowToMomentum({ current: 1, previous: 0, changePct: null, status: "insufficient" })).toBeNull();
  });
});
