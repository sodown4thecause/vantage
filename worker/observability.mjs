const ATTRIBUTE_VALUES = /^[A-Za-z0-9._:-]{1,128}$/;

function safeValue(value) {
  return typeof value === "string" && ATTRIBUTE_VALUES.test(value) ? value : undefined;
}

function safeStatus(value) {
  return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : "unknown";
}

/** Add a Cloudflare-native Worker span with only allowlisted ids and status metadata. */
export async function withObservedSpan(name, context, operation, tracing, statusFor) {
  if (!tracing || typeof tracing.enterSpan !== "function") return await operation();

  const startedAt = performance.now();
  const workspaceId = safeValue(context?.workspaceId);
  const source = safeValue(context?.source);
  const provider = safeValue(context?.provider);
  const attributes = {
    ...(workspaceId ? { workspaceId } : {}),
    ...(source ? { source } : {}),
    ...(provider ? { provider } : {}),
  };
  return await tracing.enterSpan(name, async (span) => {
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
