import {
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * M1 subset of the Vantage data model (§9).
 * Deferred to later milestones: identity, draft, interaction,
 * competitor_change, cost_event, monitor_pack.
 */

export const sourceTypeEnum = pgEnum("source_type", [
  "hn",
  "rss",
  "substack",
  "reddit",
  "web_search",
  "other",
  "producthunt",
  "youtube",
  "x",
]);

export const sourcePlatformValues = [
  "hn",
  "rss",
  "substack",
  "producthunt",
  "youtube",
  "reddit",
  "x",
] as const;
export type SourcePlatform = (typeof sourcePlatformValues)[number];

export const sourceLaneEnum = pgEnum("source_lane", [
  "free",
  "paid",
  "byok",
]);

export const sourceHealthEnum = pgEnum("source_health", [
  "healthy",
  "degraded",
  "failing",
  "paused",
  /** Slice 2 coverage labels (Settings → Sources & Coverage). */
  "access_pending",
  "budget_limited",
  "blocked",
  "failed",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "queued",
  "reviewing",
  "approved",
  "rejected",
  "posted",
  "expired",
]);

/** How product URL / docs material was resolved during onboarding. */
export const productMaterialStatusEnum = pgEnum("product_material_status", [
  "ok",
  "inaccessible",
  "manual",
]);

/** Opportunity Queue lifecycle (Slice 3). */
export const opportunityStatusEnum = pgEnum("opportunity_status", [
  "ignore",
  "monitor",
  "opportunity",
  "review",
]);

export const workspace = pgTable("workspace", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** Owning Neon Auth user id (neon_auth.user.id) once Auth is provisioned. */
  ownerUserId: text("owner_user_id"),
  plan: text("plan").notNull().default("free"),
  budgetUsdMonth: numeric("budget_usd_month", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  /** Encrypted BYOK material; never log plaintext. */
  byokKeys: jsonb("byok_keys").$type<Record<string, unknown>>().default({}),
  laneConsents: jsonb("lane_consents")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  postingHealth: jsonb("posting_health")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const source = pgTable(
  "source",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: sourceTypeEnum("type").notNull(),
    lane: sourceLaneEnum("lane").notNull().default("free"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    health: sourceHealthEnum("health").notNull().default("healthy"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    cursor: text("cursor"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("source_workspace_name_uidx").on(table.workspaceId, table.name),
  ],
);

export const document = pgTable(
  "document",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => source.id, {
      onDelete: "set null",
    }),
    urlCanonical: text("url_canonical").notNull(),
    platform: text("platform").$type<SourcePlatform>().notNull(),
    authorRef: text("author_ref"),
    title: text("title"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    contentMd: text("content_md").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    rawSnapshotRef: text("raw_snapshot_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("document_workspace_hash_uidx").on(
      table.workspaceId,
      table.contentHash,
    ),
  ],
);

export const lead = pgTable("lead", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => document.id, { onDelete: "cascade" }),
  intentRung: integer("intent_rung").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  score: real("score").notNull().default(0),
  factors: jsonb("factors").$type<Record<string, unknown>>().notNull().default({}),
  windowMinutes: integer("window_minutes"),
  reason: text("reason"),
  status: leadStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Append-only monitoring profile versions (Slice 1).
 * Downstream ranking/drafting pin a stable `version` per workspace.
 */
export const monitoringProfile = pgTable(
  "monitoring_profile",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    productUrl: text("product_url").notNull(),
    docsUrls: jsonb("docs_urls").$type<string[]>().notNull().default([]),
    productDescription: text("product_description").notNull(),
    targetCustomer: text("target_customer").notNull(),
    competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    productMaterialStatus: productMaterialStatusEnum("product_material_status")
      .notNull()
      .default("manual"),
    productMaterialText: text("product_material_text").notNull().default(""),
    retrievalNotes: text("retrieval_notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("monitoring_profile_workspace_version_uidx").on(
      table.workspaceId,
      table.version,
    ),
  ],
);


/**
 * Evidence-backed opportunity (Slice 3). Multiple documents cluster into one row.
 */
export const opportunity = pgTable(
  "opportunity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    status: opportunityStatusEnum("status").notNull().default("review"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    whyItMatters: text("why_it_matters").notNull().default(""),
    whyNow: text("why_now").notNull().default(""),
    recommendedAction: text("recommended_action").notNull().default(""),
    confidence: real("confidence").notNull().default(0),
    urgency: real("urgency").notNull().default(0),
    score: real("score").notNull().default(0),
    coverage: text("coverage").notNull().default("unknown"),
    /** Deterministic feature vector for ranking/explainability. */
    features: jsonb("features")
      .$type<Record<string, number | string | boolean>>()
      .notNull()
      .default({}),
    clusterKey: text("cluster_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("opportunity_workspace_cluster_uidx").on(
      table.workspaceId,
      table.clusterKey,
    ),
  ],
);

export const opportunityEvidence = pgTable(
  "opportunity_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("opportunity_evidence_opp_doc_uidx").on(
      table.opportunityId,
      table.documentId,
    ),
  ],
);

export type Workspace = typeof workspace.$inferSelect;
export type NewWorkspace = typeof workspace.$inferInsert;
export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
export type DocumentRecord = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type Lead = typeof lead.$inferSelect;
export type NewLead = typeof lead.$inferInsert;
export type MonitoringProfile = typeof monitoringProfile.$inferSelect;
export type NewMonitoringProfile = typeof monitoringProfile.$inferInsert;
export type Opportunity = typeof opportunity.$inferSelect;
export type NewOpportunity = typeof opportunity.$inferInsert;
export type OpportunityEvidence = typeof opportunityEvidence.$inferSelect;
export type NewOpportunityEvidence = typeof opportunityEvidence.$inferInsert;

