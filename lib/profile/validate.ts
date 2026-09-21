import type {
  FieldErrors,
  MonitoringProfileInput,
  ValidationResult,
} from "@/lib/profile/types";

const MIN_COMPETITORS = 3;
const MAX_COMPETITORS = 5;
const MIN_TOPICS = 1;
const MAX_TOPICS = 12;
const MAX_DOCS = 8;
const MAX_TEXT = 8_000;
const MAX_MANUAL = 50_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate founder onboarding input and return field-level errors.
 */
export function validateMonitoringProfileInput(
  raw: unknown,
): ValidationResult {
  const body = (raw ?? {}) as Record<string, unknown>;
  const errors: FieldErrors = {};

  const productUrl = asString(body.productUrl);
  if (!productUrl) {
    errors.productUrl = "Product URL is required.";
  } else if (!isHttpUrl(productUrl)) {
    errors.productUrl = "Product URL must be a valid http(s) URL.";
  }

  const docsUrls = asStringList(body.docsUrls, MAX_DOCS);
  for (const docsUrl of docsUrls) {
    if (!isHttpUrl(docsUrl)) {
      errors.docsUrls = "Every docs URL must be a valid http(s) URL.";
      break;
    }
  }

  const productDescription = asString(body.productDescription);
  if (!productDescription) {
    errors.productDescription = "Product description is required.";
  } else if (productDescription.length > MAX_TEXT) {
    errors.productDescription = `Product description must be ≤ ${MAX_TEXT} characters.`;
  }

  const targetCustomer = asString(body.targetCustomer);
  if (!targetCustomer) {
    errors.targetCustomer = "Target customer is required.";
  } else if (targetCustomer.length > MAX_TEXT) {
    errors.targetCustomer = `Target customer must be ≤ ${MAX_TEXT} characters.`;
  }

  const competitors = asStringList(body.competitors, MAX_COMPETITORS);
  if (competitors.length < MIN_COMPETITORS) {
    errors.competitors = `Provide ${MIN_COMPETITORS}–${MAX_COMPETITORS} competitors.`;
  } else if (competitors.length > MAX_COMPETITORS) {
    errors.competitors = `Provide at most ${MAX_COMPETITORS} competitors.`;
  }

  const topics = asStringList(body.topics, MAX_TOPICS);
  if (topics.length < MIN_TOPICS) {
    errors.topics = "Add at least one important topic or problem.";
  }

  const productMaterialManual = asString(body.productMaterialManual);
  if (productMaterialManual.length > MAX_MANUAL) {
    errors.productMaterialManual = `Manual product material must be ≤ ${MAX_MANUAL} characters.`;
  }

  const forceManualMaterial = Boolean(body.forceManualMaterial);

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const value: MonitoringProfileInput = {
    productUrl,
    docsUrls,
    productDescription,
    targetCustomer,
    competitors,
    topics,
    productMaterialManual: productMaterialManual || undefined,
    forceManualMaterial,
  };
  return { ok: true, value };
}
