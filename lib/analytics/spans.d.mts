export type SpanAttributeValue = string | number | boolean | undefined;
export type CloudflareSpan = {
  setAttribute(name: string, value: SpanAttributeValue): unknown;
  setAttributes(attributes: Record<string, SpanAttributeValue>): unknown;
};
export type CloudflareTracing = {
  enterSpan<T>(name: string, callback: (span: CloudflareSpan) => T): T;
};
export type ObservedSpanContext = {
  workspaceId?: string;
  source?: string;
  provider?: string;
};
export function withObservedSpan<T>(
  name: string,
  context: ObservedSpanContext,
  operation: () => T | Promise<T>,
  tracing?: CloudflareTracing,
  statusFor?: (result: T) => string,
): Promise<T>;
