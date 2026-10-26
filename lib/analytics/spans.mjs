const ATTRIBUTE_VALUES = /^[A-Za-z0-9._:-]{1,128}$/;

let runtimeTracingPromise;

async function getRuntimeTracing() {
  runtimeTracingPromise ??= (async () => {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      return getCloudflareContext().ctx?.tracing ?? null;
    } catch {
      return null;
    }
  })();
  return runtimeTracingPromise;
}

function safeValue(value) {
  return typeof value === "string" && ATTRIBUTE_VALUES.test(value) ? value : undefined;
}

function safeStatus(value) {
  return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : "unknown";
}

/**
 * Add a Cloudflare-native custom span. Only workspaceId, source, provider, status and durationMs
 * are ever attached; the name is a fixed operation label, never a URL, prompt, or payload.
 */
export async function withObservedSpan(name, context, operation, tracing, statusFor) {
  const api = tracing ?? await getRuntimeTracing();
  if (!api) return await operation();

  const startedAt = performance.now();
  const attributes = {
    ...(safeValue(context?.workspaceId) ? { workspaceId: safeValue(context.workspaceId) } : {}),
    ...(safeValue(context?.source) ? { source: safeValue(context.source) } : {}),
    ...(safeValue(context?.provider) ? { provider: safeValue(context.provider) } : {}),
  };
  return await api.enterSpan(name, async (span) => {
    span.setAttributes(attributes);
    let status = "ok";
    try {
      const result = await operation();
      if (statusFor) status = safeStatus(statusFor(result));
      return result;
    } catch (error) {
      status = "error";
      throw error;
    } finally {
      span.setAttribute("status", status);
      span.setAttribute("durationMs", Math.max(0, Math.round(performance.now() - startedAt)));
    }
  });
}
