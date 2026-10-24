import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { copyThenOpen, type HandoffEvent } from "@/lib/handoff/copy-and-open";

/**
 * A small model of the browser rules that matter here (verified in Chromium): a clipboard write
 * needs the page to hold focus when it is made, and opening a new tab moves focus to that tab.
 */
function browser(options: { popupBlocked?: boolean; approveError?: string; clipboardDenied?: boolean } = {}) {
  const log: string[] = [];
  const state = { focused: true, clipboard: null as string | null, recorded: [] as HandoffEvent[] };
  let release!: (text: string) => void;
  const approval = new Promise<string>((resolve) => { release = resolve; });
  const deps = {
    prepare: () => {
      log.push("prepare");
      if (options.approveError) return Promise.reject(new Error(options.approveError));
      return approval;
    },
    writeClipboard: async (text: Promise<string>) => {
      log.push("clipboard:start");
      if (!state.focused || options.clipboardDenied) {
        log.push("clipboard:denied");
        throw new DOMException("Document is not focused.", "NotAllowedError");
      }
      state.clipboard = await text;
      log.push("clipboard:done");
    },
    openThread: () => {
      log.push("open");
      if (options.popupBlocked) return false;
      state.focused = false;
      return true;
    },
    record: async (event: HandoffEvent) => {
      log.push("record:" + event);
      state.recorded.push(event);
      return true;
    },
  };
  return { deps, state, log, release };
}

describe("copy then open", () => {
  it("starts the clipboard write inside the click, before any await and before a tab can take focus", () => {
    const env = browser();
    void copyThenOpen(env.deps, { openAfterCopy: true });
    expect(env.log).toEqual(["prepare", "clipboard:start"]);
    expect(env.state.focused).toBe(true);
  });

  it("copies while focused, then opens the tab, then records both events in order", async () => {
    const env = browser();
    const pending = copyThenOpen(env.deps, { openAfterCopy: true });
    env.release("Approved reply");
    await expect(pending).resolves.toEqual({ copied: true, opened: true, copyRecorded: true });
    expect(env.state.clipboard).toBe("Approved reply");
    expect(env.log).toEqual(["prepare", "clipboard:start", "clipboard:done", "record:copy", "open", "record:open"]);
    expect(env.state.focused).toBe(false);
  });

  it("does not open the thread when only copying", async () => {
    const env = browser();
    const pending = copyThenOpen(env.deps, { openAfterCopy: false });
    env.release("Approved reply");
    await expect(pending).resolves.toEqual({ copied: true, opened: false, copyRecorded: true });
    expect(env.log).not.toContain("open");
    expect(env.state.recorded).toEqual(["copy"]);
  });

  it("opens nothing and records nothing when the draft cannot be approved, keeping the server's message", async () => {
    const env = browser({ approveError: "Review the facts and this community's rules before handoff." });
    const pending = copyThenOpen(env.deps, { openAfterCopy: true });
    const result = await pending;
    expect(result).toEqual({ copied: false, opened: false, error: "Review the facts and this community's rules before handoff." });
    expect(env.log).not.toContain("open");
    expect(env.state.recorded).toEqual([]);
  });

  it("reports a denied clipboard without opening a tab or recording a copy", async () => {
    const env = browser({ clipboardDenied: true });
    const pending = copyThenOpen(env.deps, { openAfterCopy: true });
    env.release("Approved reply");
    const result = await pending;
    expect(result).toEqual({ copied: false, opened: false, error: "Document is not focused." });
    expect(env.log).not.toContain("open");
    expect(env.state.recorded).toEqual([]);
  });

  it("keeps the copy but records no open event when the browser blocks the new tab", async () => {
    const env = browser({ popupBlocked: true });
    const pending = copyThenOpen(env.deps, { openAfterCopy: true });
    env.release("Approved reply");
    await expect(pending).resolves.toEqual({ copied: true, opened: false, copyRecorded: true });
    expect(env.state.recorded).toEqual(["copy"]);
  });

  it("shows why the old order failed: a tab opened before the write leaves the clipboard unable to write", async () => {
    const env = browser();
    env.deps.openThread();
    await expect(env.deps.writeClipboard(Promise.resolve("late"))).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(env.state.clipboard).toBeNull();
  });
});

describe("reply panel wiring", () => {
  it("opens the thread only through copyThenOpen, never by reserving a tab at click time", () => {
    const panel = readFileSync("app/opportunities/[id]/draft-panel.tsx", "utf8");
    expect(panel).toContain("copyThenOpen(");
    expect(panel).not.toContain("about:blank");
    expect(panel.match(/window\.open\(/g)).toHaveLength(1);
    expect(panel.indexOf("writeClipboard: writeClipboardDuringClick")).toBeLessThan(panel.indexOf("openThread:"));
  });
});
