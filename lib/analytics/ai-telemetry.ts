import { OpenTelemetry } from "@ai-sdk/otel";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { registerTelemetry } from "ai";

import { posthogHost, posthogKey } from "@/lib/analytics/config";
import { getCloudflareRequestContext } from "@/lib/cf/env";

type TelemetryEnvironment = Readonly<Record<string, string | undefined>>;
type TelemetryState = { provider: BasicTracerProvider; fullContentEnabled: boolean };

declare global {
  // The Worker isolate and local dev server both reuse this singleton across requests.
  var __vantagePostHogAiTelemetry: TelemetryState | undefined;
}

function captureContentAllowed(env: TelemetryEnvironment): boolean {
  return env.VANTAGE_DEPLOY_ENV === "staging" && env.POSTHOG_LLM_CAPTURE_CONTENT === "1";
}

/** AI SDK 7 telemetry options: retain inputs and outputs only for an explicitly opted-in staging isolate. */
export function aiTelemetrySettings(
  functionId: string,
  env: TelemetryEnvironment = process.env,
): {
  isEnabled: boolean;
  functionId: string;
  recordInputs: boolean;
  recordOutputs: boolean;
  includeRuntimeContext: { posthog_distinct_id: true; workspaceId: true };
} {
  const enabled = Boolean(env.NEXT_PUBLIC_POSTHOG_KEY?.trim());
  const captureContent = enabled && captureContentAllowed(env);
  return {
    isEnabled: enabled,
    functionId,
    recordInputs: captureContent,
    recordOutputs: captureContent,
    includeRuntimeContext: { posthog_distinct_id: true, workspaceId: true },
  };
}

/** Runtime context is selectively copied by our OTel enrichment callback; never pass prompts or tool payloads here. */
export function aiTelemetryContext(userId: string | undefined, workspaceId: string): Record<string, string> {
  return { ...(userId ? { posthog_distinct_id: userId } : {}), workspaceId };
}

function registerOnce(): TelemetryState | undefined {
  if (globalThis.__vantagePostHogAiTelemetry) return globalThis.__vantagePostHogAiTelemetry;
  const key = posthogKey();
  if (!key) return undefined;

  const fullContentEnabled = captureContentAllowed(process.env);
  const processor = new PostHogSpanProcessor({
    projectToken: key,
    host: posthogHost(),
    privacyMode: !fullContentEnabled,
  });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  // Use a dedicated tracer from the BasicTracerProvider rather than installing NodeSDK or a global SDK.
  const integration = new OpenTelemetry({
    tracer: provider.getTracer("vantage-ai"),
    usage: true,
    providerMetadata: false,
    runtimeContext: false,
    enrichSpan: ({ runtimeContext }) => {
      const userId = runtimeContext?.posthog_distinct_id;
      const workspaceId = runtimeContext?.workspaceId;
      return {
        ...(typeof userId === "string" ? { "posthog.distinct_id": userId } : {}),
        ...(typeof workspaceId === "string" ? { workspaceId } : {}),
      };
    },
  });
  registerTelemetry(integration);
  const state = { provider, fullContentEnabled };
  globalThis.__vantagePostHogAiTelemetry = state;
  return state;
}

/** Builds AI SDK options and lazily registers one PostHog processor in this isolate. */
export function posthogAiTelemetry(functionId: string) {
  registerOnce();
  return aiTelemetrySettings(functionId);
}

/** Values passed as AI SDK runtimeContext; enrichment emits only user identity and workspaceId. */
export function posthogAiContext(userId: string | undefined, workspaceId: string): Record<string, string> {
  return aiTelemetryContext(userId, workspaceId);
}

async function requestWaitUntil(): Promise<((promise: Promise<unknown>) => void) | null> {
  const ctx = await getCloudflareRequestContext();
  return typeof ctx?.waitUntil === "function" ? (promise) => ctx.waitUntil?.(promise) : null;
}

/** Flush AI spans without delaying a Worker response; outside Cloudflare, await the flush directly. */
export async function flushPostHogAiTelemetry(): Promise<void> {
  const state = globalThis.__vantagePostHogAiTelemetry;
  if (!state) return;
  try {
    const waitUntil = await requestWaitUntil();
    if (waitUntil) {
      waitUntil(Promise.resolve().then(() => state.provider.forceFlush()).catch(() => undefined));
      return;
    }
    await state.provider.forceFlush();
  } catch {
    // Telemetry must never turn a successful product request into a failure.
  }
}
