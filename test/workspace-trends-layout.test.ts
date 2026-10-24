import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { WorkspaceClient } from "@/app/workspace/workspace-client";

vi.mock("@/components/topic-trends", () => ({
  TopicTrends: () => createElement("section", { "aria-label": "Topic trends" }, "Trends appear after 7 days of scans."),
}));

it("keeps loaded trends inside the assistant column and evidence beside it", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceClient, {
    workspaceId: "workspace-1", productName: "Example", hasProfile: true,
    initialEvidence: [], configured: true,
  }));
  expect(html).toMatch(/aria-label="GTM assistant"><div[^>]*><section aria-label="Topic trends">/);
  expect(html).toMatch(/<\/section><aside[^>]*aria-label="Supporting evidence"/);
});
