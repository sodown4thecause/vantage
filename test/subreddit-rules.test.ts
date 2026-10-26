import { afterEach, describe, expect, it, vi } from "vitest";

import { ruleLineFor, SUBREDDIT_RULES, subredditOf } from "@/lib/reddit/subreddit-rules";

afterEach(() => vi.unstubAllGlobals());

describe("stored subreddit rules", () => {
  it("holds the 36 rules read on 23 October with a rules page for each", () => {
    const rules = Object.values(SUBREDDIT_RULES);
    expect(rules).toHaveLength(36);
    for (const rule of rules) {
      expect(rule.rulesUrl).toBe(`https://www.reddit.com/r/${rule.name}/about/rules/`);
      expect(rule.checked).toBe("2026-10-23");
    }
  });

  it("answers from the stored table without any network call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(ruleLineFor("https://www.reddit.com/r/Entrepreneur/comments/abc/x/")).toEqual({
      text: "r/Entrepreneur does not allow self-promotion. Reply to help, not to pitch.",
      url: "https://www.reddit.com/r/Entrepreneur/about/rules/",
      checked: "23 Oct 2026",
    });
    expect(ruleLineFor("https://www.reddit.com/r/indiehackers/comments/abc/x/").text).toBe("r/indiehackers allows self-promotion only if you say who you are.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches the subreddit case-insensitively and prefers the collector's subreddit name", () => {
    expect(ruleLineFor("https://example.com/x", "r/LOCALLLAMA").text).toContain("r/LocalLLaMA");
    expect(ruleLineFor("https://www.reddit.com/r/localllama/comments/1/x/").url).toBe("https://www.reddit.com/r/LocalLLaMA/about/rules/");
  });

  it("is honest when the rule is unclear, unknown, or not on Reddit", () => {
    expect(ruleLineFor("https://www.reddit.com/r/SideProject/comments/1/x/").text).toContain("could not read r/SideProject's self-promotion rule");
    expect(ruleLineFor("https://www.reddit.com/r/SomeNewSub/comments/1/x/")).toEqual({
      text: "We have no stored rule for r/SomeNewSub yet. Check its rules before you reply.",
      url: "https://www.reddit.com/r/SomeNewSub/about/rules/",
      checked: null,
    });
    expect(ruleLineFor("https://github.com/o/r/issues/1")).toEqual({ text: "Check this community's rules before you reply.", url: null, checked: null });
  });

  it("treats names that collide with object properties as unknown rather than throwing", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(ruleLineFor(`https://www.reddit.com/r/${name}/comments/1/x/`).text).toContain(`no stored rule for r/${name}`);
    }
  });

  it("only trusts well-formed subreddit names", () => {
    expect(subredditOf("https://old.reddit.com/r/SaaS/comments/1/x/")).toBe("SaaS");
    expect(subredditOf("https://evilreddit.com/r/SaaS/")).toBeNull();
    expect(subredditOf("not a url", "../etc")).toBeNull();
    expect(subredditOf("https://www.reddit.com/user/someone")).toBeNull();
  });
});
