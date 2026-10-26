import { describe, expect, it } from "vitest";

import { buildContentAgentInstructions } from "@/lib/content-agent/agent";

describe("Content agent brand voice instructions", () => {
  it("starts a five-question AI interview and blocks drafting until a profile is saved", () => {
    const instructions = buildContentAgentInstructions(null);
    expect(instructions).toContain("five-question interview one question at a time");
    expect(instructions).toContain("Invite an optional pasted writing sample");
    expect(instructions).toContain("Do not create a draft before a profile has been saved");
  });

  it("injects a saved profile into every draft and offers profile updates", () => {
    const instructions = buildContentAgentInstructions({
      audience: "Founder-led teams",
      purpose: "Help readers choose wisely.",
      voice: "Warm and direct.",
      structure: "Short sections.",
      avoid: ["hype"],
    });
    expect(instructions).toContain("follow it for every draft");
    expect(instructions).toContain("show the full humanised draft body in the conversation");
    expect(instructions).toContain("Founder-led teams");
    expect(instructions).toContain("conduct the short interview and save the updated profile");
  });
});
