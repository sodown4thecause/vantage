import { Scavio } from "scavio";

import { optionalEnv, type EnvLike } from "@/lib/env/server";

export function hasScavioApiKey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(optionalEnv("SCAVIO_API_KEY", env as EnvLike));
}

export function createScavioClient(
  apiKey: string = optionalEnv("SCAVIO_API_KEY") ?? "",
): Scavio {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("SCAVIO_API_KEY is not configured");
  }
  return new Scavio({ apiKey: key });
}
