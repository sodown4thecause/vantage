import { TinyFish } from "@tiny-fish/sdk";

/**
 * Shared TinyFish SDK client. Uses TINYFISH_API_KEY from the environment
 * (also accepted by the SDK constructor default).
 */
export function createTinyFishClient(
  apiKey: string = process.env.TINYFISH_API_KEY ?? "",
): TinyFish {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("TINYFISH_API_KEY is not configured");
  }
  return new TinyFish({ apiKey: key });
}

export function hasTinyFishApiKey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.TINYFISH_API_KEY?.trim());
}
