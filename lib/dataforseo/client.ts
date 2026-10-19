import type { DataForSeoConfig } from "@/lib/dataforseo/config";
import { fetchPublicText } from "@/lib/http/public-fetch";

const SUCCESS = 20000;
const BALANCE_PATH = "/v3/appendix/user_data";
const INVALID = "DataForSEO returned an invalid response";

/**
 * Upstream or envelope failure. statusCode 0 means the body was not a DataForSEO envelope.
 * costUsd is undefined when no cost could be read; the spend gate then charges its estimate.
 */
export class DataForSeoApiError extends Error {
  constructor(readonly statusCode: number, message: string, readonly costUsd: number | undefined) {
    super(message);
    this.name = "DataForSeoApiError";
  }
}

export type DataForSeoResult<T> = { result: T[]; costUsd: number | undefined };

type Options = { signal?: AbortSignal; fetchImpl?: typeof fetch };
type Envelope = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const reportedCost = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

// Returns the first task of a 20000 envelope and its cost; throws on any failure with the cost DataForSEO reported.
async function sendTask(config: DataForSeoConfig, method: "GET" | "POST", path: string, task: Record<string, unknown> | undefined, opts: Options): Promise<{ task: Envelope; cost: number | undefined }> {
  if (!path.startsWith("/v3/")) throw new Error("DataForSEO paths must start with /v3/");
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.login}:${config.password}`).toString("base64")}`,
  };
  if (task) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method, headers, body: task ? JSON.stringify([task]) : undefined, cache: "no-store", signal: opts.signal };
  const { response, text } = await fetchPublicText(`${config.baseUrl}${path}`, init, 2_000_000, opts.fetchImpl ?? fetch, 60_000);
  if (!response.ok) throw new DataForSeoApiError(response.status, `DataForSEO request failed (${response.status})`, undefined);

  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new DataForSeoApiError(0, INVALID, undefined); }
  if (!isRecord(payload)) throw new DataForSeoApiError(0, INVALID, undefined);

  const envelopeTask = Array.isArray(payload.tasks) && isRecord(payload.tasks[0]) ? payload.tasks[0] : undefined;
  const cost = reportedCost(envelopeTask?.cost) ?? reportedCost(payload.cost);
  const status = payload.status_code;
  if (typeof status !== "number") throw new DataForSeoApiError(0, INVALID, cost);
  if (status !== SUCCESS) throw new DataForSeoApiError(status, `DataForSEO request failed (${status})`, cost);

  if (!envelopeTask) throw new DataForSeoApiError(0, INVALID, cost);
  const taskStatus = envelopeTask.status_code;
  if (typeof taskStatus !== "number") throw new DataForSeoApiError(0, INVALID, cost);
  if (taskStatus !== SUCCESS) throw new DataForSeoApiError(taskStatus, `DataForSEO task failed (${taskStatus})`, cost);
  return { task: envelopeTask, cost };
}

/**
 * POSTs `[task]` to a /v3/ endpoint. Callers own spend control; this client does no budget logic.
 * costUsd is undefined when neither the task nor the envelope reports a readable cost; the gate then charges its estimate.
 */
export async function dataForSeoPost<T>(config: DataForSeoConfig, path: string, task: Record<string, unknown>, opts: Options = {}): Promise<DataForSeoResult<T>> {
  const { task: envelopeTask, cost } = await sendTask(config, "POST", path, task, opts);
  return { result: Array.isArray(envelopeTask.result) ? envelopeTask.result as T[] : [], costUsd: cost };
}

/** Account balance in USD from GET /v3/appendix/user_data. */
export async function getDataForSeoBalance(config: DataForSeoConfig, opts: Options = {}): Promise<number> {
  const { task: envelopeTask } = await sendTask(config, "GET", BALANCE_PATH, undefined, opts);
  const first = Array.isArray(envelopeTask.result) && isRecord(envelopeTask.result[0]) ? envelopeTask.result[0] : undefined;
  const balance = first && isRecord(first.money) ? first.money.balance : undefined;
  if (typeof balance !== "number" || !Number.isFinite(balance)) throw new Error("DataForSEO balance response is invalid");
  return balance;
}
