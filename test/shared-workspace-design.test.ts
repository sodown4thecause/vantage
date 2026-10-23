import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Shell } from "@/components/shell";
import { WorkspaceFrame, type WorkspaceSection } from "@/components/workspace-frame";

describe("shared workspace design", () => {
  it.each<WorkspaceSection>(["workspace", "queue", "seo", "geo", "content", "sources", "profile", "plan", "digest", "review"])("keeps the same sidebar and accessible content frame for %s", (active) => {
    const html = renderToStaticMarkup(WorkspaceFrame({ workspaceId: "owned-workspace", active, children: "Page content" }));
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).toContain('id="main"');
    expect(html).toContain('href="#main"');
    expect(html).toContain("Page content");
    for (const path of ["/workspace", "/seo", "/content", "/queue", "/settings/sources", "/settings/digest"]) expect(html).toContain(`${path}?workspaceId=owned-workspace`);
    // Product setup runs as the interview inside /workspace; the sidebar no longer links to /onboarding.
    expect(html).toContain("/workspace?workspaceId=owned-workspace&amp;setup=1");
    expect(html).not.toContain("/onboarding");
    expect(html).not.toContain('aria-label="Site"');
  });

  it("renders app pages through the same frame rather than the marketing header", () => {
    const html = renderToStaticMarkup(Shell({ workspaceId: "owned-workspace", active: "sources", children: "Sources" }));
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).not.toContain('aria-label="Site"');
  });

  it("keeps public pages in the matching public shell without workspace links", () => {
    const html = renderToStaticMarkup(Shell({ section: "pricing", children: "Pricing" }));
    expect(html).toContain('aria-label="Site"');
    expect(html).not.toContain('aria-label="Workspace navigation"');
    expect(html).toContain('href="/tour"');
  });

  it("demo navigation has a sign-up action and never links to sign-out", () => {
    const html = renderToStaticMarkup(WorkspaceFrame({ demo: true, children: "Demo" }));
    expect(html).toContain("Sample workspace");
    expect(html).toContain('href="/auth/sign-up"');
    expect(html).not.toContain("/auth/sign-out");
  });
});
