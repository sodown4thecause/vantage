/**
 * Minimal ambient declarations for the Workers runtime `cloudflare:workers`
 * module and its Workflow API.
 *
 * This repo is a Next.js app bundled by OpenNext for Cloudflare, not a plain
 * Worker, so `@cloudflare/workers-types` is not installed and TS cannot resolve
 * the virtual module. We declare only the surface this codebase uses. When the
 * repo adopts `wrangler types` (see the `cf:typegen` script) or
 * `@cloudflare/workers-types`, this file can be deleted — the runtime module is
 * real at deploy time; it is only missing at compile time.
 */
declare module "cloudflare:workers" {
  /** Retry/timeout config for one step. */
  export interface WorkflowStepConfig {
    retries?: { limit: number; delay?: string; backoff?: "constant" | "linear" | "exponential" };
    timeout?: string;
  }

  /** A durable workflow execution. */
  export interface Workflow<P = unknown> {
    create(options?: { id?: string; params?: P }): Promise<WorkflowInstance>;
  }

  export interface WorkflowInstance {
    id: string;
    status(): Promise<unknown>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    terminate(): Promise<void>;
  }

  export interface WorkflowEvent<P = unknown> {
    payload: P;
    timestamp: Date;
    instanceId: string;
    workflowName: string;
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
    constructor(ctx: unknown, env: Env);
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }

  export class NonRetryableError extends Error {
    constructor(message: string, name?: string);
  }
}
