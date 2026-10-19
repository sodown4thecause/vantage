import type { Scavio } from "scavio";

export function hasScavioApiKey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.SCAVIO_API_KEY?.trim());
}

export async function createScavioClient(
  apiKey: string = process.env.SCAVIO_API_KEY ?? "",
): Promise<Scavio> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("SCAVIO_API_KEY is not configured");
  }
  const { Scavio } = await import("scavio");
  return new Scavio({ apiKey: key, maxRetries: 0, timeout: 30_000 });
}
