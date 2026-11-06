export const PRODUCT_MATERIAL_STATUSES = [
  "ok",
  "inaccessible",
  "manual",
] as const;

export type ProductMaterialStatus = (typeof PRODUCT_MATERIAL_STATUSES)[number];

/** Writable onboarding fields (no version/id). */
export type MonitoringProfileInput = {
  productUrl: string;
  docsUrls: string[];
  productDescription: string;
  targetCustomer: string;
  competitors: string[];
  topics: string[];
  /** When product URL cannot be fetched, founder-supplied material. */
  productMaterialManual?: string;
  /** When true, skip network fetch and mark material as manual. */
  forceManualMaterial?: boolean;
};

export type FieldErrors = Partial<
  Record<
    | "productUrl"
    | "docsUrls"
    | "productDescription"
    | "targetCustomer"
    | "competitors"
    | "topics"
    | "productMaterialManual",
    string
  >
>;

export type ValidationResult =
  | { ok: true; value: MonitoringProfileInput }
  | { ok: false; errors: FieldErrors };

export type ProductMaterialResult = {
  status: ProductMaterialStatus;
  text: string;
  notes: string;
};

/** Present on a saved profile only when the relevance gate refused to create its default sources. */
export type SkippedSources = { topics: string[]; reasons: string[]; message: string };

export type MonitoringProfileView = {
  id: string;
  workspaceId: string;
  version: number;
  productUrl: string;
  docsUrls: string[];
  productDescription: string;
  targetCustomer: string;
  competitors: string[];
  topics: string[];
  productMaterialStatus: ProductMaterialStatus;
  productMaterialText: string;
  retrievalNotes: string;
  createdAt: string;
  skippedSources?: SkippedSources;
};
