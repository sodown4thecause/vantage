import { describe, expect, it } from "vitest";

import { readScanHealth, scanIssuesFromError, summariseScanHealth, type ScanIssue } from "@/lib/scan/health";

const access: ScanIssue = { stage: "discovery", kind: "access_pending", provider: "reddit", retryable: false };
const upstream: ScanIssue = { stage: "hydration", kind: "upstream_failed", provider: "tinyfish_search_fetch", retryable: true };

describe("summariseScanHealth", () => {
  it.each([
    { name: "completed empty search", discovered: 0, verified: 0, completed: true, cancelled: false, issues: [], state: "complete" },
    { name: "missing access", discovered: 0, verified: 0, completed: false, cancelled: false, issues: [access], state: "failed" },
    { name: "genuine results before a later failure", discovered: 2, verified: 1, completed: true, cancelled: false, issues: [upstream], state: "partial" },
    { name: "preview-only discovery", discovered: 2, verified: 0, completed: true, cancelled: false, issues: [], state: "partial" },
    { name: "verified results with a hydration failure", discovered: 1, verified: 1, completed: true, cancelled: false, issues: [upstream], state: "partial" },
    { name: "cancellation after discovery", discovered: 1, verified: 0, completed: false, cancelled: true, issues: [], state: "cancelled" },
    { name: "unfinished empty search", discovered: 0, verified: 0, completed: false, cancelled: false, issues: [], state: "failed" },
    { name: "fully verified results", discovered: 2, verified: 2, completed: true, cancelled: false, issues: [], state: "complete" },
    { name: "malformed provider envelope", discovered: 0, verified: 0, completed: false, cancelled: false,
      issues: [{ stage: "discovery", kind: "invalid_payload", retryable: false }], state: "failed" },
  ] as const)("reports $name", ({ discovered, verified, completed, cancelled, issues, state }) => {
    expect(summariseScanHealth({ discovered, verified, completed, cancelled, issues: [...issues] })).toEqual({
      state, discovered, verified, issues,
    });
  });
});

it("strips private details from stored health and rejects invalid categories", () => {
  const health = { state: "partial", discovered: 1, verified: 0, privateData: "secret",
    issues: [{ ...upstream, message: "secret", provider: "https://private.test/secret" }] };
  expect(readScanHealth(health)).toEqual({ state: "partial", discovered: 1, verified: 0,
    issues: [{ stage: "hydration", kind: "upstream_failed", retryable: true }] });
  expect(readScanHealth({ ...health, verified: 2 })).toBeUndefined();
  expect(readScanHealth({ ...health, issues: [{ stage: "unknown", kind: "private exception", retryable: true }] })).toBeUndefined();
});

it.each([
  [Object.assign(new Error("private detail"), { code: "provider_disabled" }), "provider_disabled", false],
  [Object.assign(new Error("private detail"), { code: "budget_exhausted" }), "budget_exhausted", false],
  [Object.assign(new Error("private detail"), { code: "access_pending" }), "access_pending", false],
  [new Error("Provider 429 private detail"), "rate_limited", true],
  [new Error("Provider 503 private detail"), "upstream_failed", true],
  [new DOMException("private detail", "AbortError"), "aborted", false],
] as const)("classifies failure %s without exposing provider text", (error, kind, retryable) => {
  expect(scanIssuesFromError(error, "discovery", "reddit")).toEqual([{ stage: "discovery", kind, provider: "reddit", retryable }]);
});
