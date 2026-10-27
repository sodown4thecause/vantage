import { describe, expect, it } from "vitest";

import { journeyActionsFromClient } from "@/app/seo/journey";

const starters = [
  { category: "seo" as const, text: "Starter SEO question", costLabel: "Est. ~1 credit", recommended: true, reason: "Starter reason" },
  { category: "geo" as const, text: "Starter GEO question", costLabel: "Est. ~2 credits" },
  { category: "content" as const, text: "Starter content question", costLabel: "Free" },
];

describe("journeyActionsFromClient reasons", () => {
  it("does not reuse the starter's reason for a chip that shows a follow-up", () => {
    const chips = journeyActionsFromClient({
      focus: "seo",
      starters,
      followUps: { seo: "Which phrases are still open?", geo: "g", content: "c" },
      latestTools: ["llm_response"],
    });
    const recommended = chips.find((chip) => chip.recommended)!;
    expect(recommended.text).toBe("Which phrases are still open?");
    expect(recommended.reason).toBe("You checked AI answers — next find the search phrases still open.");
  });

  it("keeps the starter's reason while the starter itself is shown", () => {
    const chips = journeyActionsFromClient({ focus: "seo", starters });
    expect(chips.find((chip) => chip.recommended)!.reason).toBe("Starter reason");
  });
});
