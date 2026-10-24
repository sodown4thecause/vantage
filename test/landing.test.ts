import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("landing launch cut", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  it("keeps Vantage, the requested hero, mission and direct calls to action", () => {
    expect(page).toContain("Vantage: the go-to-market workspace for AI and developer tools");
    expect(page).toContain("Launch is the new bottleneck.");
    expect(page).toContain("You can ship in a weekend. Getting noticed still takes a team.");
    expect(page).toContain("Everyone’s shipping. Few are launching.");
    expect(page).toContain("Ship it. Then let people know.");
    expect(page.match(/name: "Vantage"/g)).toHaveLength(3);
    expect(page).toContain('href="/pricing"');
    expect(page).toContain(">Start free");
    expect(page.indexOf("<ProductTourBox />")).toBeLessThan(page.indexOf("</section>"));
  });
  it("labels unbuilt workflows Coming soon and does not show fabricated source quotes", () => {
    expect(page).toMatch(/SEO <span className={styles.badge}>Coming soon/);
    expect(page).toMatch(/AI search visibility <span className={styles.badge}>Coming soon/);
    expect(page).toMatch(/Content and social <span className={styles.badge}>Coming soon/);
    expect(page).not.toContain("Preview</span>");
    expect(page).not.toContain("<blockquote>");
    expect(page).not.toContain("In-app content publishing is coming soon");
    expect(page).toContain("Vantage never posts, comments or votes on your behalf");
  });
});
