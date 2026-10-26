/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentDraftRow } from "@/lib/content-agent/repository";
import { ContentLibrary } from "@/app/content/content-library";

const state = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function draft(overrides: Partial<ContentDraftRow> = {}): ContentDraftRow {
  return {
    id: DRAFT_A,
    workspaceId: WORKSPACE_ID,
    threadId: null,
    title: "Useful draft",
    body: "A useful point [source](https://example.com/guide).",
    format: "blog_post",
    status: "draft",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    ...overrides,
  };
}

function jsonResponse(row: ContentDraftRow): Response {
  return {
    ok: true,
    json: async () => ({ draft: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } }),
  } as Response;
}

let container: HTMLDivElement;
let root: Root;

async function renderLibrary(drafts: ContentDraftRow[] = [draft()]): Promise<void> {
  await act(async () => root.render(<ContentLibrary workspaceId={WORKSPACE_ID} initialDrafts={drafts} />));
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function selects(): HTMLSelectElement[] {
  return Array.from(container.querySelectorAll("select"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.refresh.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ContentLibrary component", () => {
  it("filters by status, format, and source and shows the no-match state", async () => {
    const other = draft({
      id: DRAFT_B,
      title: "A thread",
      body: "Notes from https://other.example/post",
      format: "x_thread",
      status: "ready",
    });
    await renderLibrary([draft(), other]);

    const [statusFilter, formatFilter, sourceFilter] = selects();
    await changeSelect(statusFilter, "ready");
    await changeSelect(formatFilter, "x_thread");
    await changeSelect(sourceFilter, "other.example");
    expect(container.textContent).toContain("Showing 1 of 2");
    expect(container.textContent).toContain("A thread");

    await changeSelect(sourceFilter, "example.com");
    expect(container.textContent).toContain("No saved drafts match these filters.");

    await renderLibrary([draft({ status: "idea" }), other]);
    expect(selects()[0]?.value).toBe("ready");
    expect(selects()[1]?.value).toBe("x_thread");
    expect(selects()[2]?.value).toBe("example.com");
  });

  it("updates status, refreshes workspace props, and sends the workspace id", async () => {
    const updated = draft({ status: "ready", updatedAt: new Date("2026-10-03T00:00:00.000Z") });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated));
    vi.stubGlobal("fetch", fetchMock);
    await renderLibrary();

    const statusSelect = selects()[3];
    await changeSelect(statusSelect, "ready");

    expect(fetchMock).toHaveBeenCalledWith(`/api/content/drafts/${DRAFT_A}`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, status: "ready" }),
    }));
    expect(statusSelect.value).toBe("ready");
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("keeps each draft disabled only while its own update is pending", async () => {
    const other = draft({ id: DRAFT_B, title: "A thread", format: "x_thread", status: "draft" });
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    await renderLibrary([draft(), other]);

    const [firstStatus, secondStatus] = selects().slice(3);
    const updatedFirst = draft({ status: "ready", updatedAt: new Date("2026-10-03T00:00:00.000Z") });
    const updatedSecond = draft({ id: DRAFT_B, title: "A thread", format: "x_thread", status: "ready", updatedAt: new Date("2026-10-03T00:00:00.000Z") });

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(firstStatus, "ready");
      firstStatus.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(secondStatus, "ready");
      secondStatus.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(firstStatus.disabled).toBe(true);
    expect(secondStatus.disabled).toBe(true);

    await act(async () => resolvers[0]?.(jsonResponse(updatedFirst)));
    expect(firstStatus.disabled).toBe(false);
    expect(secondStatus.disabled).toBe(true);
    await act(async () => resolvers[1]?.(jsonResponse(updatedSecond)));
    expect(secondStatus.disabled).toBe(false);
  });

  it("shows a save error without changing the selected status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await renderLibrary();

    const statusSelect = selects()[3];
    await changeSelect(statusSelect, "ready");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Draft status could not be saved");
    expect(statusSelect.value).toBe("draft");
  });

  it("downloads the Markdown body with sources and shows the empty state", async () => {
    await renderLibrary();
    const createObjectUrl = vi.fn((blob: Blob) => {
      expect(blob).toBeInstanceOf(Blob);
      return "blob:content-draft";
    });
    const revokeObjectUrl = vi.fn();
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("useful-draft.md");
    });

    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());

    expect(createObjectUrl).toHaveBeenCalledOnce();
    const exportedBlob = createObjectUrl.mock.calls[0]?.[0];
    expect(exportedBlob).toBeInstanceOf(Blob);
    expect(await exportedBlob?.text()).toContain("https://example.com/guide");
    expect(click).toHaveBeenCalledOnce();

    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    else Reflect.deleteProperty(URL, "revokeObjectURL");

    await act(async () => root.render(<ContentLibrary workspaceId={WORKSPACE_ID} initialDrafts={[]} />));
    expect(container.textContent).toContain("Drafts you save while writing will appear here.");
  });
});
