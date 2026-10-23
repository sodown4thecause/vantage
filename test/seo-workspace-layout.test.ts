import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { ChatClient } from "@/app/seo/chat-client";

describe("research workspace layout", () => {
  it("keeps exactly three next actions and a multiline composer even without supplied starters", () => {
    const html = renderToStaticMarkup(createElement(ChatClient, {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      conversationId: null,
      initialMessages: [],
      starters: [],
      sandbox: true,
      focus: "geo",
    }));
    expect(html.match(/aria-label="(?:SEO|GEO|Content) question:/g)).toHaveLength(3);
    expect(html.match(/>Recommended<\/span>/g)).toHaveLength(1);
    expect(html.indexOf('aria-label="GEO question:')).toBeLessThan(html.indexOf('aria-label="SEO question:'));
    expect(html).toContain("<textarea");
    expect(html).toContain('rows="2"');
    expect(html).toContain("Understand your AI visibility.");
    expect(html).toContain("Sandbox data: not real figures.");
    expect(html).toContain('aria-label="Supporting research"');
    expect(html).toContain("<details");
    expect(html).not.toMatch(/~\d credit/);
  });

  it("places history in the shared focused frame and preserves the GEO focus", () => {
    const source = readFileSync("app/seo/page.tsx", "utf8");
    expect(source).toContain("<WorkspaceFrame workspaceId={workspaceId} active={focus} focused");
    expect(source).toContain('tools={<nav aria-label="Research conversations">');
    expect(source).toContain('key={selected?.id ?? "new"}');
    expect(source).toContain('if (focus === "geo") search.set("focus", focus)');
    expect(source).not.toContain("PageHead");
    expect(source).not.toContain("13rem");
  });
});
