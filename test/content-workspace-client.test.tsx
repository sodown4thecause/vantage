import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ cursor: 0, values: [] as Array<{ value: unknown }> }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hookState.cursor++;
      const slot = hookState.values[index] ?? (hookState.values[index] = {
        value: typeof initial === "function" ? (initial as () => unknown)() : initial,
      });
      return [slot.value, (next: unknown) => {
        slot.value = typeof next === "function" ? (next as (value: unknown) => unknown)(slot.value) : next;
      }];
    },
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => {
      const index = hookState.cursor++;
      return (hookState.values[index] ??= { value: { current: initial } }).value;
    },
    useReducer: (reducer: (state: unknown, action: unknown) => unknown, initial: unknown) => {
      const index = hookState.cursor++;
      const slot = hookState.values[index] ?? (hookState.values[index] = { value: initial });
      return [slot.value, (action: unknown) => { slot.value = reducer(slot.value, action); }];
    },
  };
});
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor() {} } }));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    clearError: vi.fn(),
    status: "ready",
    error: undefined,
    stop: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { ContentWorkspaceClient } from "@/app/content/content-workspace-client";
import { SuggestedPrompts } from "@/app/content/suggested-prompts";
import type { ContentBrandVoiceProfileRow } from "@/lib/content-agent/repository";

function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  for (const child of Array.isArray(node) ? node : [node]) {
    if (!isValidElement(child)) continue;
    if (child.type === type) return child;
    const nested = findElement((child.props as { children?: ReactNode }).children, type);
    if (nested) return nested;
  }
}

beforeEach(() => {
  hookState.cursor = 0;
  hookState.values = [];
});

it("fills the composer input with the selected suggested prompt", () => {
  const prompt = "Write a useful Australian-English post about onboarding.";
  const props = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    selectedThreadId: null,
    initialMessages: [],
    threads: [],
    drafts: [],
    threadDrafts: [],
    brandVoiceProfile: null as ContentBrandVoiceProfileRow | null,
    suggestedPrompts: [prompt],
  };

  hookState.cursor = 0;
  const initialTree = ContentWorkspaceClient(props);
  const canvas = findElement(initialTree, "section");
  const canvasChildren = Children.toArray((canvas?.props as { children?: ReactNode }).children);
  const suggestionsIndex = canvasChildren.findIndex((child) => isValidElement(child) && child.type === SuggestedPrompts);
  const composerIndex = canvasChildren.findIndex((child) => isValidElement(child) && child.type === "form");
  expect(suggestionsIndex).toBeGreaterThanOrEqual(0);
  expect(suggestionsIndex).toBeLessThan(composerIndex);

  const suggestions = findElement(initialTree, SuggestedPrompts) as ReactElement<{
    onSelect: (selected: string) => void;
  }> | undefined;
  expect(suggestions).toBeDefined();

  suggestions!.props.onSelect(prompt);

  hookState.cursor = 0;
  const updatedTree = ContentWorkspaceClient(props);
  const composer = findElement(updatedTree, "textarea") as ReactElement<{ value: string }> | undefined;
  expect(composer?.props.value).toBe(prompt);
});
