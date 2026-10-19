import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Shell } from "@/components/shell";

const SEO_HREF = "/seo?workspaceId=ws-1";

function renderNav(): string {
  return renderToStaticMarkup(Shell({ children: null, workspaceId: "ws-1", active: "queue" }));
}

function configure(env: Record<string, string>): void {
  vi.stubEnv("DATAFORSEO_USERNAME", "");
  vi.stubEnv("DATAFORSEO_LOGIN", env.DATAFORSEO_LOGIN ?? "");
  vi.stubEnv("DATAFORSEO_PASSWORD", env.DATAFORSEO_PASSWORD ?? "");
  vi.stubEnv("NODE_ENV", env.NODE_ENV ?? "test");
  vi.stubEnv("ALLOW_FIXTURES", env.ALLOW_FIXTURES ?? "");
}

describe("workspace nav SEO item", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is hidden when DataForSEO is not configured", () => {
    configure({});
    expect(renderNav()).not.toContain(SEO_HREF);
  });

  it("is shown when sandbox is configured outside production", () => {
    configure({ DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p" });
    expect(renderNav()).toContain(SEO_HREF);
  });

  it("is hidden for sandbox in production unless ALLOW_FIXTURES is true", () => {
    configure({ DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p", NODE_ENV: "production" });
    expect(renderNav()).not.toContain(SEO_HREF);
    configure({ DATAFORSEO_LOGIN: "u", DATAFORSEO_PASSWORD: "p", NODE_ENV: "production", ALLOW_FIXTURES: "true" });
    expect(renderNav()).toContain(SEO_HREF);
  });
});
