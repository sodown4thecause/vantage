import { describe, expect, it } from "vitest";

import { contentRepurposeDraftAfterFinish } from "@/app/content/content-workspace-client";

describe("Content workspace repurpose retries", () => {
  const repurposeDraft = {
    draftId: "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a14",
    format: "linkedin_post" as const,
  };

  it.each([
    { isAbort: false, isDisconnect: false, isError: true },
    { isAbort: true, isDisconnect: false, isError: false },
    { isAbort: false, isDisconnect: true, isError: false },
  ])("retains the original draft metadata after a failed turn: %o", (outcome) => {
    expect(contentRepurposeDraftAfterFinish(repurposeDraft, outcome)).toEqual(repurposeDraft);
  });

  it("clears the retry metadata after a successful turn", () => {
    expect(contentRepurposeDraftAfterFinish(repurposeDraft, {
      isAbort: false,
      isDisconnect: false,
      isError: false,
    })).toBeNull();
  });
});
