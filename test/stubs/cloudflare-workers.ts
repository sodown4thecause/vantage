/**
 * Vitest runtime stub for the Workers virtual module `cloudflare:workers`.
 *
 * The real module is supplied by the Workers runtime and is not resolvable under
 * Node, so `pnpm test` cannot import any file that transitively imports it. This
 * stub mirrors only the behaviour our tests rely on: instantiating a
 * `WorkflowEntrypoint` subclass. The driving of `run` is done by the tests
 * themselves with a hand-rolled `WorkflowStep` double, so no scheduling logic
 * lives here.
 *
 * `types/cloudflare-workers.d.ts` keeps TypeScript honest about the same
 * surface; this file keeps the test runner honest at runtime.
 */

export interface WorkflowStepConfig {
  retries?: { limit: number; delay?: string; backoff?: "constant" | "linear" | "exponential" };
  timeout?: string;
}

export interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: string): Promise<void>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
  waitForEvent<T>(name: string, options: { type: string; timeout?: string }): Promise<{ payload: T; timestamp: Date }>;
}

export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  abstract run(event: { payload: Params; timestamp: Date; instanceId: string; workflowName: string }, step: WorkflowStep): Promise<unknown>;
}

export class NonRetryableError extends Error {
  constructor(message: string, name?: string) {
    super(message);
    this.name = name ?? "NonRetryableError";
  }
}
