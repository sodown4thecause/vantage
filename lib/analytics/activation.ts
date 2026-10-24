export type ActivationEvent = "signup" | "url_confirmed" | "first_scan_started" | "first_scan_completed" | "first_scan_failed" | "digest_sent" | "unsubscribe";

export async function captureActivation(_event: ActivationEvent, _workspaceId: string, _properties: Record<string, string | number | boolean> = {}): Promise<void> {}
