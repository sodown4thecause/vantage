import { describe, expect, it } from "vitest";

import { SITUATIONS, type Situation } from "@/lib/pipeline/situation";
import {
  noPlayReason,
  suggestPlays,
  VENUE_MODES,
  type VenueMode,
} from "@/lib/plays/suggest";

const suggest = (
  situation: Situation,
  venueMode: VenueMode = "link_ok",
  productHasDocs = true,
) => suggestPlays({ situation, venueMode, productHasDocs });

describe("suggestPlays default play per situation", () => {
  const defaults: Array<[Situation, string]> = [
    ["tool_request", "reply_brief"],
    ["alternative_request", "reply_brief"],
    ["price_pain", "reply_brief"],
    ["migration", "migration_guide"],
    ["integration_gap", "reply_brief"],
    ["built_it_myself", "reply_brief"],
    ["free_tier_request", "reply_brief"],
    ["breakage", "reply_brief"],
    ["how_solved", "reply_brief"],
    ["evaluation", "reply_brief"],
    ["team_need", "reply_brief"],
    ["production_check", "reply_brief"],
  ];
  it.each(defaults)("%s leads with %s", (situation, kind) => {
    expect(suggest(situation)[0]?.kind).toBe(kind);
  });

  it("adds the supporting plays from the plan table", () => {
    const kinds = (s: Situation) => suggest(s).map((p) => p.kind);
    expect(kinds("alternative_request")).toEqual([
      "reply_brief",
      "comparison_page",
      "directory_submission",
    ]);
    expect(kinds("free_tier_request")).toContain("trial_offer");
    expect(kinds("integration_gap")).toContain("integration");
    expect(kinds("migration")).toEqual(["migration_guide", "importer", "reply_brief"]);
  });

  it("suggests nothing for other, and explains why", () => {
    expect(suggest("other")).toEqual([]);
    expect(noPlayReason({ situation: "other", productHasDocs: true })).toMatch(/No play/);
  });

  it("gates production_check on product docs", () => {
    expect(suggest("production_check", "link_ok", false)).toEqual([]);
    expect(
      noPlayReason({ situation: "production_check", productHasDocs: false }),
    ).toMatch(/production/);
    expect(suggest("production_check", "link_ok", true)).toHaveLength(1);
  });

  it("returns a play for every situation except the gated ones", () => {
    for (const s of SITUATIONS) {
      if (s === "other") continue;
      expect(suggest(s).length).toBeGreaterThan(0);
    }
  });
});

describe("venue mode changes the action, not the rank", () => {
  it("sets the link policy on reply briefs", () => {
    for (const mode of VENUE_MODES) {
      const brief = suggest("tool_request", mode)[0]!;
      expect(brief.linkPolicy).toBe(mode);
    }
  });

  it("brief_only forbids drafts; other modes allow them", () => {
    expect(suggest("tool_request", "brief_only")[0]).toMatchObject({
      draftAllowed: false,
      title: expect.stringContaining("brief only"),
    });
    expect(suggest("tool_request", "no_link")[0]?.draftAllowed).toBe(true);
    expect(suggest("tool_request", "no_link")[0]?.rationale).toMatch(/Do not include a link/);
    expect(suggest("tool_request", "link_ok")[0]?.rationale).toMatch(/allows a link/);
  });

  it("how_solved never links by default, even where links are fine", () => {
    expect(suggest("how_solved", "link_ok")[0]?.linkPolicy).toBe("no_link");
    expect(suggest("how_solved", "brief_only")[0]?.linkPolicy).toBe("brief_only");
  });

  it("does not apply the venue gate to plays outside the venue", () => {
    const comparison = suggest("alternative_request", "brief_only").find(
      (p) => p.kind === "comparison_page",
    )!;
    expect(comparison.linkPolicy).toBeNull();
    expect(comparison.draftAllowed).toBe(true);
  });

  it("is pure: same input, same output", () => {
    expect(suggest("migration", "no_link")).toEqual(suggest("migration", "no_link"));
  });
});
