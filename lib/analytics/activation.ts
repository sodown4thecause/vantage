import { captureProductEvent } from "@/lib/analytics/server";

export type ActivationEvent = "signup" | "url_confirmed" | "first_scan_started" | "first_scan_completed" | "first_scan_failed" | "digest_sent" | "unsubscribe";

/** Keeps existing activation call sites aligned with the privacy-safe product event helper. */
export async function captureActivation(
  event: ActivationEvent,
  workspaceId: string,
  properties: Record<string, string | number | boolean> = {},
): Promise<void> {
  if (event === "signup") {
    await captureProductEvent({ event: "signed_up", workspaceId });
  } else if (event === "url_confirmed") {
    await captureProductEvent({ event: "profile_confirmed", workspaceId });
  } else if (event === "first_scan_started") {
    await captureProductEvent({ event: "scan_started", workspaceId });
  } else if (event === "first_scan_completed" || event === "first_scan_failed") {
    await captureProductEvent({
      event: "scan_finished",
      workspaceId,
      read: numberProperty(properties, "read"),
      relevant: numberProperty(properties, "relevant"),
      picked: numberProperty(properties, "picked"),
      capped: properties.capped === true,
    });
  } else if (event === "digest_sent") {
    await captureProductEvent({ event: "digest_sent", workspaceId });
  } else if (event === "unsubscribe") {
    await captureProductEvent({ event: "unsubscribed", workspaceId });
  }
}

function numberProperty(properties: Record<string, string | number | boolean>, key: string): number {
  const value = properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
