import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("landing claims and lead capture boundaries", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const box = readFileSync("components/product-tour-box.tsx", "utf8");

  it("uses the requested title, headline, mission and calls to action", () => {
    expect(page).toContain("Vantage: the go-to-market workspace for AI and developer tools");
    expect(page).toContain("Launch is the new bottleneck.");
    expect(page).toContain("You can ship in a weekend. Getting noticed still takes a team.");
    expect(page).toContain("Everyone’s shipping. Few are launching.");
    expect(page).toContain("Ship it. Then let people know.");
    expect(page).toContain('href="/pricing"');
    expect(page).toContain(">Start free");
    expect(page.indexOf("<ProductTourBox />")).toBeLessThan(page.indexOf("</section>"));
  });

  it("marks unshipped replacements and source suggestions honestly", () => {
    expect(page).toMatch(/SEO <span className={styles.badge}>Preview/);
    expect(page).toMatch(/AI search visibility <span className={styles.badge}>Preview/);
    expect(page).toMatch(/Link building <span className={styles.badge}>Coming soon/);
    expect(page).toMatch(/Content and social <span className={styles.badge}>Coming soon/);
    expect(page).toContain("Connected Search Console and ongoing ranking reports are coming soon");
    expect(box).toContain("Coverage preview · no live scan");
    expect(box).toContain("Coming soon");
    expect(box).toContain("no email is sent yet");
    expect(box).toContain("pickForumDomains(product)");
  });

  it("keeps the form unavailable without Turnstile and removes the former demo brand", () => {
    expect(box).toContain('disabled={!token || state === "saving"}');
    expect(box).toContain('"expired-callback": () => setToken("")');
    expect(box).toContain('"x-turnstile-token": token');
    for (const file of ["app/tour/tour-data.ts", "app/tour/tour-demo.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/tracewell/i);
    }
  });
});
