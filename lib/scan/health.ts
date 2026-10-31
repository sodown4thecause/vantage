export type ScanIssue = {
  stage: "dispatch" | "discovery" | "hydration" | "persist" | "review";
  kind: "provider_disabled" | "access_pending" | "budget_exhausted" | "rate_limited" | "upstream_failed" | "invalid_payload" | "aborted";
  provider?: string;
  retryable: boolean;
};

export type ScanHealth = {
  state: "complete" | "partial" | "failed" | "cancelled";
  discovered: number;
  verified: number;
  issues: ScanIssue[];
};

export function summariseScanHealth(input: {
  discovered: number; verified: number; completed: boolean; cancelled: boolean; issues: ScanIssue[];
}): ScanHealth {
  const incomplete = !input.completed || input.issues.length > 0 || input.verified < input.discovered;
  return {
    state: input.cancelled ? "cancelled" : incomplete ? input.discovered > 0 ? "partial" : "failed" : "complete",
    discovered: input.discovered, verified: input.verified, issues: input.issues,
  };
}

/** A provider failure can cross fallback boundaries without exposing its exception text. */
export class ScanFailure extends Error {
  constructor(readonly issues: ScanIssue[], message = "Scan provider unavailable") {
    super(message);
    this.name = "ScanFailure";
  }
}

export function scanIssuesFromError(error: unknown, stage: ScanIssue["stage"], provider?: string): ScanIssue[] {
  if (error instanceof ScanFailure) return error.issues;
  if (error instanceof Error && "issues" in error) {
    const health = readScanHealth({ state: "failed", discovered: 0, verified: 0, issues: error.issues });
    if (health) return health.issues;
  }
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const kind: ScanIssue["kind"] = error instanceof Error && error.name === "AbortError" ? "aborted"
    : code === "provider_disabled" || code === "access_pending" || code === "budget_exhausted" ? code
    : /429|rate.?limit|throttl/i.test(message) ? "rate_limited"
    : /budget|allowance|quota/i.test(message) ? "budget_exhausted"
    : /access[_\s-]?pending|api[_\s-]?key|unauthorized|401|403|forbidden|not configured|missing/i.test(message) ? "access_pending"
    : /invalid|malformed/i.test(message) || error instanceof TypeError || error instanceof SyntaxError ? "invalid_payload"
    : "upstream_failed";
  return [{ stage, kind, ...(provider ? { provider } : {}), retryable: kind === "upstream_failed" || kind === "rate_limited" }];
}

/** Stored JSON is untrusted; return only the bounded public health contract. */
export function readScanHealth(value: unknown): ScanHealth | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const o = value as Record<string, unknown>;
  if (!["complete", "partial", "failed", "cancelled"].includes(String(o.state)) ||
      !Number.isSafeInteger(o.discovered) || Number(o.discovered) < 0 ||
      !Number.isSafeInteger(o.verified) || Number(o.verified) < 0 || Number(o.verified) > Number(o.discovered) || !Array.isArray(o.issues)) return;
  const issues: ScanIssue[] = [];
  for (const raw of o.issues) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const issue = raw as Record<string, unknown>;
    if (!["dispatch", "discovery", "hydration", "persist", "review"].includes(String(issue.stage)) ||
        !["provider_disabled", "access_pending", "budget_exhausted", "rate_limited", "upstream_failed", "invalid_payload", "aborted"].includes(String(issue.kind)) ||
        typeof issue.retryable !== "boolean") return;
    issues.push({ stage: issue.stage as ScanIssue["stage"], kind: issue.kind as ScanIssue["kind"], retryable: issue.retryable,
      ...(typeof issue.provider === "string" && /^[a-z0-9_-]{1,64}$/.test(issue.provider) ? { provider: issue.provider } : {}) });
  }
  return { state: o.state as ScanHealth["state"], discovered: Number(o.discovered), verified: Number(o.verified), issues };
}
