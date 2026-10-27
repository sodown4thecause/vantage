export type HandoffEvent = "copy" | "open";

export type CopyAndOpenDeps = {
  /** Saves and approves the draft on the server and resolves to the approved text. Rejects with a readable message. */
  prepare: () => Promise<string>;
  /** Starts the clipboard write. It receives the pending text so it can be called inside the click. */
  writeClipboard: (text: Promise<string>) => Promise<void>;
  /** Opens the thread in a new tab. Returns whether a tab actually opened. */
  openThread: () => boolean;
  record: (event: HandoffEvent) => Promise<boolean>;
};

export type CopyAndOpenResult =
  | { copied: false; opened: false; error: string }
  | { copied: true; opened: boolean; copyRecorded: boolean };

/**
 * The click handler's work, in the order browsers need. The clipboard write starts first and
 * synchronously, while the page still has focus and the click's user activation; the draft is
 * approved while it waits. The thread tab opens only after the write has settled, because a tab
 * opened earlier takes focus and leaves the later clipboard write waiting. The open event is only
 * recorded when a tab opened.
 */
export async function copyThenOpen(deps: CopyAndOpenDeps, options: { openAfterCopy: boolean }): Promise<CopyAndOpenResult> {
  const text = deps.prepare();
  text.catch(() => undefined);
  try {
    await deps.writeClipboard(text);
  } catch (clipboardError) {
    const prepareError = await text.then(() => null, (error: unknown) => error);
    const cause = prepareError ?? clipboardError;
    const message = cause instanceof Error && cause.message ? cause.message : "Could not copy. Check clipboard access and try again.";
    return { copied: false, opened: false, error: message };
  }
  const copyRecorded = await deps.record("copy");
  if (!options.openAfterCopy) return { copied: true, opened: false, copyRecorded };
  const opened = deps.openThread();
  if (opened) await deps.record("open");
  return { copied: true, opened, copyRecorded };
}

/** Writes pending text to the clipboard in a way that works from inside a click. */
export function writeClipboardDuringClick(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    return navigator.clipboard.write([
      new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
    ]);
  }
  return text.then((value) => navigator.clipboard.writeText(value));
}
