import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RetentionLists } from "@/app/queue/retention-lists";
import { DraftPanel } from "@/app/opportunities/[id]/draft-panel";
import { FeedbackPanel } from "@/app/opportunities/[id]/feedback-panel";
import { ruleLineFor } from "@/lib/reddit/subreddit-rules";

const conversation = (url: string, platform: string, subreddit?: string) => ({
  documentId: "doc-1", title: "Looking for a tool", urlCanonical: url, platform, ruleLine: ruleLineFor(url, subreddit),
});

describe("reply panel", () => {
  it("shows the stored subreddit rule line and a link to the rules above the draft", () => {
    const html = renderToStaticMarkup(
      <DraftPanel workspaceId="ws-1" opportunityId="op-1" conversations={[conversation("https://www.reddit.com/r/Entrepreneur/comments/1/x/", "reddit")]} />,
    );
    expect(html).toContain("r/Entrepreneur does not allow self-promotion. Reply to help, not to pitch.");
    expect(html).toContain("Rule checked 23 Oct 2026");
    expect(html).toContain('href="https://www.reddit.com/r/Entrepreneur/about/rules/"');
    expect(html).toContain("Write a draft");
    expect(html).toContain("You edit it and post it yourself");
  });

  it("sends AI-prohibited venues to a research brief with the venue's own policy", () => {
    const html = renderToStaticMarkup(
      <DraftPanel workspaceId="ws-1" opportunityId="op-1" conversations={[conversation("https://news.ycombinator.com/item?id=1", "hn")]} />,
    );
    expect(html).toContain("Hacker News prohibits AI-written replies");
    expect(html).toContain("Build research brief");
    expect(html).not.toContain("Write a draft");
  });

  it("uses design tokens rather than raw zinc classes", () => {
    const panels = [
      renderToStaticMarkup(<DraftPanel workspaceId="ws-1" opportunityId="op-1" conversations={[conversation("https://www.reddit.com/r/SaaS/comments/1/x/", "reddit")]} />),
      renderToStaticMarkup(<FeedbackPanel workspaceId="ws-1" opportunityId="op-1" initialState="sent" />),
    ].join("");
    expect(panels).not.toMatch(/zinc-|emerald-|red-600/);
    expect(panels).toContain("border-contour");
  });
});

describe("feedback panel", () => {
  it("lets the owner mark outcomes themselves and add the link later", () => {
    const html = renderToStaticMarkup(<FeedbackPanel workspaceId="ws-1" opportunityId="op-1" initialState="copied" />);
    expect(html).toContain("You tell Vantage; it cannot see the thread.");
    expect(html).toContain("Reply copied.");
    expect(html).toContain("Mark sent");
    expect(html).toContain("Mark replied");
    expect(html).toContain("Link to your reply (optional)");
  });

  it("hides marks the owner has already made", () => {
    const html = renderToStaticMarkup(<FeedbackPanel workspaceId="ws-1" opportunityId="op-1" initialState="replied" />);
    expect(html).toContain("You marked this replied to.");
    expect(html).not.toContain("Mark sent");
    expect(html).not.toContain("Mark replied");
  });
});

describe("queue retention lists", () => {
  const props = {
    workspaceId: "ws-1",
    today: "2026-10-24",
    timeZone: "Australia/Sydney",
    earlier: { day: "2026-10-23", picks: [
      { opportunityId: "o1", title: "Needs an SEO tool", state: null },
      { opportunityId: "o2", title: "Comparing monitoring apps", state: "sent" as const },
    ] },
    marked: [{ opportunityId: "o2", title: "Comparing monitoring apps", state: "sent" as const, markedAt: "2026-10-23T05:00:00.000Z" }],
    recap: { copied: 12, sent: 7, replied: 2 },
  };

  it("shows yesterday's five collapsed, with the owner's own marks", () => {
    const html = renderToStaticMarkup(<RetentionLists {...props} />);
    expect(html).toContain("Yesterday&#x27;s five");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Needs an SEO tool");
    expect(html).toContain("You marked this sent");
    expect(html).toContain("Mark sent");
    expect(html).toContain("Sent and replied");
    expect(html).toContain("This month you&#x27;ve copied 12 replies, marked 7 sent and had 2 replies back.");
  });

  it("labels an older day by its date and renders nothing when there is no history", () => {
    const older = renderToStaticMarkup(<RetentionLists {...props} earlier={{ ...props.earlier, day: "2026-10-20" }} />);
    expect(older).toContain("Your picks from 20 Oct");
    expect(older).not.toContain("Yesterday&#x27;s five");
    expect(renderToStaticMarkup(<RetentionLists {...props} earlier={null} marked={[]} recap={{ copied: 0, sent: 0, replied: 0 }} />)).toBe("");
  });
});
