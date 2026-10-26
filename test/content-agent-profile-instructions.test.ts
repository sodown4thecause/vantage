import { describe, expect, it } from "vitest";

import { buildContentAgentInstructions } from "@/lib/content-agent/agent";

describe("Content agent brand voice instructions", () => {
  it("starts a five-question AI interview and blocks drafting until a profile is saved", () => {
    const instructions = buildContentAgentInstructions(null);
    expect(instructions).toContain("five-question interview one question at a time");
    expect(instructions).toContain("Invite an optional pasted writing sample");
    expect(instructions).toContain("Do not create a new draft before a profile has been saved");
    expect(instructions).toContain("direct them to the private draft card's Save changes action without requiring an interview");
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
    expect(instructions).toContain("displays the full humanised body in an editable private-draft card");
    expect(instructions).toContain("call the matching ranked conversation, ranked keyword, or competitor gap source tool first");
    expect(instructions).toContain("Supported draft formats: blog outline, full blog post, X thread, LinkedIn post, Reddit reply, Hacker News reply, and newsletter section.");
    expect(instructions).toContain("Do not invent evidence, sources, metrics, or claims.");
    expect(instructions).toContain("Only call update_content_draft when the incoming request includes a structured draftUpdate payload");
    expect(instructions).toContain("direct the owner to edit the private draft card and use Save changes");
    expect(instructions).toContain("never claim that chat alone saved an edit");
    expect(instructions).toContain("Founder-led teams");
    expect(instructions).toContain("conduct the short interview and save the updated profile");
  });
});
