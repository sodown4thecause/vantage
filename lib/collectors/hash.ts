import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contentHash(
  platform: string,
  urlCanonical: string,
  contentMd: string,
): string {
  return sha256Hex(`${platform}\n${urlCanonical}\n${contentMd}`);
}
