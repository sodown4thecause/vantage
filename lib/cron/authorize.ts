import { timingSafeEqual } from "node:crypto";

import { cronSecret } from "@/lib/env/server";

type CronAuthorizationOptions = {
  secret?: string;
  nodeEnv?: string;
};

export function isCronAuthorized(
  req: Request,
  options: CronAuthorizationOptions = {},
): boolean {
  const secret = options.secret ?? cronSecret();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  if (!secret) return nodeEnv !== "production";

  const supplied = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}
