import { Scavio } from "scavio";

export function hasScavioApiKey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.SCAVIO_API_KEY?.trim());
}

export function createScavioClient(
  apiKey: string = process.env.SCAVIO_API_KEY ?? "",
): Scavio {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("SCAVIO_API_KEY is not configured");
  }
  return new Scavio({ apiKey: key });
}
