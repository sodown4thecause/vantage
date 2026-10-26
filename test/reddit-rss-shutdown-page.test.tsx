import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dataforseo/config", () => ({ dataForSeoAvailable: () => false }));
vi.mock("@/lib/seo-agent/model-config", () => ({ seoModels: () => null }));

import RedditRssShutdownPage, { metadata } from "@/app/reddit-rss-shutdown/page";
import { GET as llms } from "@/app/llms.txt/route";

describe("/reddit-rss-shutdown", () => {
  const html = renderToStaticMarkup(<RedditRssShutdownPage />);

  it("states the Reddit dates and that we don't use RSS or the Reddit API", () => {
    expect(html).toContain("13 November 2026");
    expect(html).toContain("March 2027");
    expect(html).toContain("not RSS or the Reddit API");
  });

  it("keeps the never-posts promise and a sign-up call to action", () => {
    expect(html).toContain("we never post for you");
    expect(html).toContain('href="/auth/sign-up"');
  });

  it("ships FAQPage structured data and a canonical URL", () => {
    expect(html).toContain('"@type":"FAQPage"');
    expect(String(metadata.alternates?.canonical)).toMatch(/\/reddit-rss-shutdown$/);
  });

  it("is listed in llms.txt", async () => {
    expect(await llms().text()).toContain("/reddit-rss-shutdown");
  });
});
