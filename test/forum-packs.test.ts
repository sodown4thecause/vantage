import { describe, expect, it } from "vitest";

import { DEVELOPER_FORUM_DOMAINS as COLLECTOR_DEVELOPER_DOMAINS } from "@/lib/collectors/web-discussions";
import { ALL_FORUM_DOMAINS, FORUM_PACKS, pickForumDomains } from "@/lib/communities/forum-packs";

const CONTEXTFOR_PROFILE = "Find people on Reddit, Hacker News and forums asking for what you build. Social listening and buying intent alerts for founders and marketers. social listening reddit lead generation buying intent";
const DEVELOPER_TEXT = "A developer SDK and API with a database for coding agents, open source devtools and infrastructure.";

describe("forum packs", () => {
  it("keeps the developer list the collector has always searched, re-exported from the collector", () => {
    expect(COLLECTOR_DEVELOPER_DOMAINS).toBe(FORUM_PACKS.developer.domains);
    expect(FORUM_PACKS.developer.domains).toHaveLength(14);
  });

  it("lists every known forum once", () => {
    expect(new Set(ALL_FORUM_DOMAINS).size).toBe(ALL_FORUM_DOMAINS.length);
    expect(ALL_FORUM_DOMAINS).toEqual(expect.arrayContaining(["community.shopify.com", "community.hubspot.com", "dev.to"]));
    for (const pack of Object.values(FORUM_PACKS)) {
      for (const domain of pack.domains) expect(ALL_FORUM_DOMAINS).toContain(domain);
    }
  });
});

describe("pickForumDomains", () => {
  it("picks marketing and founder communities for the contextfor.dev profile, not e-commerce", () => {
    const domains = pickForumDomains(CONTEXTFOR_PROFILE);
    expect(domains).toEqual(["community.hubspot.com", "warriorforum.com", "webmasterworld.com", "indiehackers.com", "dev.to"]);
    expect(domains).not.toContain("community.shopify.com");
  });

  it("returns the developer list for developer-tools wording", () => {
    expect(pickForumDomains(DEVELOPER_TEXT)).toEqual([...FORUM_PACKS.developer.domains]);
  });

  it("returns the developer list for empty or blank text", () => {
    expect(pickForumDomains("")).toEqual([...FORUM_PACKS.developer.domains]);
    expect(pickForumDomains("   \n\t ")).toEqual([...FORUM_PACKS.developer.domains]);
  });

  it("matches keywords as whole words, so 'geo' does not match 'george'", () => {
    expect(pickForumDomains("George runs a shopify store")).toEqual(["community.shopify.com", "indiehackers.com"]);
    expect(pickForumDomains("local geo targeting")).toContain("webmasterworld.com");
  });

  it("matches 'ai agent' as a phrase, so 'maid agent' does not pull in developer communities", () => {
    expect(pickForumDomains("a maid agent for shopify merchants")).toEqual(["community.shopify.com", "indiehackers.com"]);
  });

  it("matches phrases whatever the spacing and case of the profile", () => {
    expect(pickForumDomains("SOCIAL\n  Listening for founders")).toEqual(
      ["community.hubspot.com", "warriorforum.com", "webmasterworld.com", "indiehackers.com", "dev.to"]);
  });

  it("returns at most 20 domains with no duplicates, even when every pack matches", () => {
    const everything = Object.values(FORUM_PACKS).flatMap(pack => pack.keywords).join(" ");
    const domains = pickForumDomains(everything);
    expect(domains.length).toBeLessThanOrEqual(20);
    expect(new Set(domains).size).toBe(domains.length);
    expect(domains).toEqual(ALL_FORUM_DOMAINS);
  });
});
