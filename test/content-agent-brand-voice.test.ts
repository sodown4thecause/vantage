import { describe, expect, it } from "vitest";

import { contentBrandVoiceProfileSchema } from "@/lib/content-agent/contracts";

const profile = {
  audience: "Founder-led SaaS teams",
  purpose: "Help readers make sound growth decisions.",
  voice: "Warm, direct and evidence-led.",
  structure: "Short opening, practical sections, concise close.",
  avoid: ["hype", "unsupported guarantees"],
  sampleText: "A short example in the founder's own voice.",
};

describe("Content brand voice contract", () => {
  it("validates a complete profile and preserves an optional sample", () => {
    expect(contentBrandVoiceProfileSchema.parse(profile)).toEqual(profile);
  });

  it("requires the interview's core voice details and bounds pasted samples", () => {
    expect(contentBrandVoiceProfileSchema.safeParse({ ...profile, audience: " " }).success).toBe(false);
    expect(contentBrandVoiceProfileSchema.safeParse({ ...profile, sampleText: "x".repeat(12001) }).success).toBe(false);
    expect(contentBrandVoiceProfileSchema.safeParse({
      audience: profile.audience,
      purpose: profile.purpose,
      voice: profile.voice,
      structure: profile.structure,
      avoid: profile.avoid,
    }).success).toBe(true);
  });
});
