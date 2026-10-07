import type { AccessMethod, SignalType, Source, SourceCategory, SourceTemplate } from "../types";
import { SOURCE_REGISTRY } from "./seed";

// ---------------------------------------------------------------------------
// Boundary parsing. Templates come from hand-edited config; we fail loud on any
// malformed entry rather than silently dropping sources. Once expanded, entries
// are trusted `Source`s used everywhere downstream.
// ---------------------------------------------------------------------------

const ACCESS_METHODS: ReadonlySet<string> = new Set<AccessMethod>([
  "rss",
  "atom",
  "api",
  "google_news",
  "rsshub",
]);

const CATEGORIES: ReadonlySet<string> = new Set<SourceCategory>([
  "news",
  "community",
  "qa",
  "launch",
  "blog",
  "video",
  "package-stats",
  "regulatory",
]);

const SIGNAL_TYPES: ReadonlySet<string> = new Set<SignalType>([
  "market-news",
  "competitor-mention",
  "developer-discussion",
  "product-launch",
  "vendor-content",
  "package-adoption",
  "regulatory-filing",
]);

class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

/** Substitute `{token}` occurrences, URL-encoding each value. */
function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = values[token];
    if (value === undefined) {
      throw new RegistryError(`URL template references unknown placeholder "{${token}}"`);
    }
    return encodeURIComponent(value);
  });
}

/** A stable, filename-safe id segment derived from expansion values. */
function slugify(values: Record<string, string>): string {
  return Object.values(values)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTemplate(template: SourceTemplate, index: number): ReadonlyArray<Source> {
  const where = `registry[${index}] "${template.id}"`;
  if (!ACCESS_METHODS.has(template.accessMethod)) {
    throw new RegistryError(`${where}: unknown accessMethod "${template.accessMethod}"`);
  }
  if (!CATEGORIES.has(template.category)) {
    throw new RegistryError(`${where}: unknown category "${template.category}"`);
  }
  if (!SIGNAL_TYPES.has(template.signalType)) {
    throw new RegistryError(`${where}: unknown signalType "${template.signalType}"`);
  }

  const hasUrl = template.url !== undefined;
  const hasTemplate = template.urlTemplate !== undefined;
  if (hasUrl === hasTemplate) {
    throw new RegistryError(`${where}: exactly one of "url" or "urlTemplate" must be set`);
  }

  const base = {
    name: template.name,
    category: template.category,
    accessMethod: template.accessMethod,
    pollIntervalMinutes: template.pollIntervalMinutes ?? 20,
    signalType: template.signalType,
    enabled: template.enabled ?? true,
  } as const;

  // Plain source (no expansion).
  if (hasUrl) {
    if (template.expand?.length) {
      throw new RegistryError(`${where}: "expand" is only valid with "urlTemplate"`);
    }
    return [
      {
        ...base,
        id: template.id,
        url: template.url as string,
        ...(template.note !== undefined ? { note: template.note } : {}),
        ...(template.rateLimit !== undefined ? { rateLimit: template.rateLimit } : {}),
        ...(template.stripParams !== undefined ? { stripParams: template.stripParams } : {}),
      },
    ];
  }

  // Templated source: one concrete Source per expansion row.
  const urlTemplate = template.urlTemplate as string;
  const rows = template.expand ?? [];
  if (rows.length === 0) {
    throw new RegistryError(`${where}: "urlTemplate" requires at least one "expand" row`);
  }
  return rows.map((values) => {
    const slug = slugify(values);
    const note = template.note ? `${template.note} [${slug}]` : `[${slug}]`;
    return {
      ...base,
      id: `${template.id}:${slug}`,
      url: fillTemplate(urlTemplate, values),
      note,
      ...(template.rateLimit !== undefined ? { rateLimit: template.rateLimit } : {}),
      ...(template.stripParams !== undefined ? { stripParams: template.stripParams } : {}),
    };
  });
}

/**
 * Expand the seed registry into concrete sources. Pure: same config in, same
 * sources out. Throws `RegistryError` on the first malformed entry.
 */
export function expandRegistry(
  templates: ReadonlyArray<SourceTemplate> = SOURCE_REGISTRY,
): ReadonlyArray<Source> {
  const sources = templates.flatMap(parseTemplate);
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) {
      throw new RegistryError(`duplicate source id "${source.id}"`);
    }
    ids.add(source.id);
  }
  return sources;
}

let cached: ReadonlyArray<Source> | undefined;

/** Cached expansion; templates are static config so this is safe per isolate. */
export function getSources(): ReadonlyArray<Source> {
  cached ??= expandRegistry();
  return cached;
}

/** Look up one source by id, or `undefined` when unknown. */
export function findSource(id: string): Source | undefined {
  return getSources().find((source) => source.id === id);
}
