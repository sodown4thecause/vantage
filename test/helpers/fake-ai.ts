import type { AiBinding } from "@/lib/cf/env";

export type FakeAiCall = { model: string; text: string[]; options: unknown };

export type FakeAiOptions = {
  /** Vector length returned for every input (default 1024). */
  dim?: number;
  /** Error thrown by every run call. */
  throws?: Error;
};

/** Deterministic unit-ish vector for a text: FNV-1a hash seeds a xorshift stream. */
export function fakeVector(text: string, dim = 1024): number[] {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const out: number[] = [];
  let state = seed || 1;
  for (let i = 0; i < dim; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out.push(state / 0xffffffff - 0.5);
  }
  return out;
}

/** Stand-in for env.AI that answers embedding calls. No network. */
export function createFakeAi(opts: FakeAiOptions = {}) {
  const calls: FakeAiCall[] = [];
  const dim = opts.dim ?? 1024;
  const binding: AiBinding = {
    async run(model, input, options) {
      const text = (input as { text: string[] }).text;
      calls.push({ model, text: [...text], options });
      if (opts.throws) throw opts.throws;
      return { shape: [text.length, dim], data: text.map((t) => fakeVector(t, dim)) };
    },
  };
  return { binding, calls };
}
