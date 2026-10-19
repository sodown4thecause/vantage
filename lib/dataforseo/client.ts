import type { DataForSeoConfig } from "@/lib/dataforseo/config";
import { fetchPublicText } from "@/lib/http/public-fetch";

const SUCCESS = 20000;
const BALANCE_PATH = "/v3/appendix/user_data";

/** Upstream or envelope failure. statusCode 0 means the body was not a DataForSEO envelope. */
export class DataForSeoApiError extends Error {
  constructor(readonly statusCode: number, message: string, readonly costUsd: number) {
    super(message);
    this.name = "DataForSeoApiError";
  }
}

export type DataForSeoResult<T> = { result: T[]; costUsd: number };

type Options = { signal?: AbortSignal; fetchImpl?: typeof fetch };
type Envelope = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const usd = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const code = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

// Returns the first task of a 20000 envelope; throws on any failure with the cost DataForSEO reported.
async function sendTask(config: DataForSeoConfig, method: "GET" | "POST", path: string, task: Record<string, unknown> | undefined, opts: Options): Promise<Envelope> {
  if (!path.startsWith("/v3/")) throw new Error("DataForSEO paths must start with /v3/");
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.login}:${config.password}`).toString("base64")}`,
  };
  if (task) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method, headers, body: task ? JSON.stringify([task]) : undefined, cache: "no-store", signal: opts.signal };
  const { response, text } = await fetchPublicText(`${config.baseUrl}${path}`, init, 2_000_000, opts.fetchImpl ?? fetch, 60_000);
  if (!response.ok) throw new DataForSeoApiError(response.status, `DataForSEO request failed (${response.status})`, 0);

  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new DataForSeoApiError(0, "DataForSEO returned an invalid response", 0); }
  if (!isRecord(payload)) throw new DataForSeoApiError(0, "DataForSEO returned an invalid response", 0);
  if (payload.status_code !== SUCCESS) throw new DataForSeoApiError(code(payload.status_code), `DataForSEO request failed (${code(payload.status_code)})`, usd(payload.cost));

  const envelopeTask = Array.isArray(payload.tasks) && isRecord(payload.tasks[0]) ? payload.tasks[0] : undefined;
  if (!envelopeTask) throw new DataForSeoApiError(0, "DataForSEO returned an invalid response", 0);
  if (envelopeTask.status_code !== SUCCESS) throw new DataForSeoApiError(code(envelopeTask.status_code), `DataForSEO task failed (${code(envelopeTask.status_code)})`, usd(envelopeTask.cost));
  return envelopeTask;
}

/** POSTs `[task]` to a /v3/ endpoint. Callers own spend control; this client does no budget logic. */
export async function dataForSeoPost<T>(config: DataForSeoConfig, path: string, task: Record<string, unknown>, opts: Options = {}): Promise<DataForSeoResult<T>> {
  const envelopeTask = await sendTask(config, "POST", path, task, opts);
  return { result: Array.isArray(envelopeTask.result) ? envelopeTask.result as T[] : [], costUsd: usd(envelopeTask.cost) };
}

/** Account balance in USD from GET /v3/appendix/user_data. */
export async function getDataForSeoBalance(config: DataForSeoConfig, opts: Options = {}): Promise<number> {
  const envelopeTask = await sendTask(config, "GET", BALANCE_PATH, undefined, opts);
  const first = Array.isArray(envelopeTask.result) && isRecord(envelopeTask.result[0]) ? envelopeTask.result[0] : undefined;
  const balance = first && isRecord(first.money) ? first.money.balance : undefined;
  if (typeof balance !== "number" || !Number.isFinite(balance)) throw new Error("DataForSEO balance response is invalid");
  return balance;
}
