import type { BrowserBinding } from "@/lib/browser/run";

export type FakeCall = { action: string; params: Record<string, unknown> };

export type FakeBrowserOptions = {
  /** Value placed under `result` in the JSON envelope (ignored when `raw` is set). */
  result?: unknown;
  /** Raw body, e.g. PNG bytes. */
  raw?: Uint8Array;
  ms?: number;
  status?: number;
  throws?: Error;
  /** Never resolve, to exercise the timeout. */
  hang?: boolean;
};

/** Stand-in for env.BROWSER. No network. */
export function createFakeBrowser(opts: FakeBrowserOptions = {}) {
  const calls: FakeCall[] = [];
  const binding: BrowserBinding = {
    async quickAction(action, params) {
      calls.push({ action, params });
      if (opts.hang) return new Promise<Response>(() => undefined);
      if (opts.throws) throw opts.throws;
      const headers = new Headers();
      if (opts.ms !== undefined) headers.set("X-Browser-Ms-Used", String(opts.ms));
      const body = opts.raw ?? JSON.stringify({ success: true, result: opts.result });
      return new Response(body as BodyInit, { status: opts.status ?? 200, headers });
    },
  };
  return { binding, calls };
}
