import { describe, expect, it } from "vitest";

import { EDIT_COUNT, LAST_STEP, draftText, editState, stepForProgress } from "@/lib/tour/edit-pass";

describe("tour edit pass", () => {
  it("starts on the untouched draft and ends with every tell replaced", () => {
    expect(draftText(0)).toContain("In today's fast-paced AI landscape");
    expect(draftText(LAST_STEP)).toBe(
      "Agent loops burn tokens without raising an error. When a tool call fails, the agent retries and nobody sees it. " +
        "A trace of every call shows which one failed first. Log less, and keep the parent of every call.",
    );
  });

  it("leaves no em dash or stock phrase in the finished draft", () => {
    const done = draftText(LAST_STEP);
    expect(done).not.toMatch(/—|Moreover|seamlessly|leverag|landscape/i);
  });

  it("marks an edit before it fixes it, one edit at a time", () => {
    expect(editState(0, 0)).toBe("open");
    expect(editState(0, 1)).toBe("marked");
    expect(editState(0, 2)).toBe("fixed");
    expect(editState(1, 2)).toBe("open");
    expect(editState(EDIT_COUNT - 1, LAST_STEP)).toBe("fixed");
  });

  it("maps scroll progress onto steps with a lead-in and a hold", () => {
    expect(stepForProgress(0)).toBe(0);
    expect(stepForProgress(0.1)).toBe(0);
    expect(stepForProgress(0.84)).toBe(LAST_STEP);
    expect(stepForProgress(1)).toBe(LAST_STEP);
    expect(stepForProgress(Number.NaN)).toBe(0);
    const mid = stepForProgress(0.47);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(LAST_STEP);
  });
});
