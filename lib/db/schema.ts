import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * M1 subset of the Vantage data model (§9).
 * Deferred to later milestones: identity, draft, interaction,
 * competitor_change, monitor_pack.
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
  scanLeaseToken: text("scan_lease_token"),
  scanLeaseUntil: timestamp("scan_lease_until", { withTimezone: true }),
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

export const opportunityDraft = pgTable("opportunity_draft", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunity.id, { onDelete: "cascade" }),
  /** Model/heuristic original text — immutable once created. */
  originalText: text("original_text").notNull(),
  /** User-edited text; starts equal to original. */
  editedText: text("edited_text").notNull(),
  citations: jsonb("citations")
    .$type<Array<{ label: string; url: string; documentId?: string }>>()
    .notNull()
    .default([]),
  flags: jsonb("flags")
    .$type<Array<{ claim: string; reason: string }>>()
    .notNull()
    .default([]),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Opportunity = typeof opportunity.$inferSelect;
export type NewOpportunity = typeof opportunity.$inferInsert;
export type OpportunityEvidence = typeof opportunityEvidence.$inferSelect;
export type NewOpportunityEvidence = typeof opportunityEvidence.$inferInsert;

export const opportunityOutcomeEventEnum = pgEnum("opportunity_outcome_event", [
  "useful",
  "not_useful",
  "saved",
  "rejected",
  "acted_on",
  "draft_edit",
  "published_url",
  "utm_click",
  "conversion",
]);

/** Append-only outcome/feedback audit log (Slice 5). */
export const opportunityOutcome = pgTable("opportunity_outcome", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunity.id, { onDelete: "cascade" }),
  draftId: uuid("draft_id").references(() => opportunityDraft.id, {
    onDelete: "set null",
  }),
  event: opportunityOutcomeEventEnum("event").notNull(),
  /** Optional payload (URL, UTM, notes). Never rewrite history — append corrections. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  /** Client-supplied idempotency key to avoid duplicate clicks. */
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex("opportunity_outcome_idem_uidx").on(
    table.workspaceId,
    table.idempotencyKey,
  ),
]);

export type OpportunityDraft = typeof opportunityDraft.$inferSelect;
export type NewOpportunityDraft = typeof opportunityDraft.$inferInsert;
export type OpportunityOutcome = typeof opportunityOutcome.$inferSelect;
export type NewOpportunityOutcome = typeof opportunityOutcome.$inferInsert;

/**
 * One bounded weight per learned preference key (Slice 6).
 * Deliberately aggregate-only: no collected content, titles, URLs, or author
 * references may be stored here. `findRawContentLeakage` rejects violations
 * before a version is persisted.
 */
export type PreferenceWeightRow = {
  key: string;
  dimension: string;
  positives: number;
  negatives: number;
  evidence: number;
  weight: number;
};

/**
 * Append-only, versioned per-workspace preference weights.
 * `active` is the evidence gate; `enabled` is the operator switch that makes a
 * version eligible to affect ranking, so flipping `enabled` back to false rolls
 * out instantly without touching any other workspace.
 */
export const workspacePreferenceModel = pgTable(
  "workspace_preference_model",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    weights: jsonb("weights")
      .$type<PreferenceWeightRow[]>()
      .notNull()
      .default([]),
    positiveEvents: integer("positive_events").notNull().default(0),
    negativeEvents: integer("negative_events").notNull().default(0),
    evidence: integer("evidence").notNull().default(0),
    active: boolean("active").notNull().default(false),
    disabledReason: text("disabled_reason"),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_preference_model_version_uidx").on(
      table.workspaceId,
      table.version,
    ),
  ],
);

export type WorkspacePreferenceModel = typeof workspacePreferenceModel.$inferSelect;
export type NewWorkspacePreferenceModel = typeof workspacePreferenceModel.$inferInsert;


/**
 * Phase 1 foundations (docs/superpowers/plans/2026-10-06-five-changes-on-cloudflare.md §4).
 * Cost ledger, per-source kill switches and cross-workspace shared posts.
 */

export const sourceSwitchStateValues = ["on", "paused", "blocked"] as const;
export type SourceSwitchState = (typeof sourceSwitchStateValues)[number];

/** Global on/off per source key (a `source.type` such as "reddit"). No row means "on". */
export const sourceSwitch = pgTable("source_switch", {
  sourceKey: text("source_key").primaryKey(),
  state: text("state").$type<SourceSwitchState>().notNull().default("on"),
  reason: text("reason").notNull().default(""),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  changedBy: text("changed_by"),
});

/** Append-only audit trail of every source_switch change. */
export const sourceSwitchLog = pgTable("source_switch_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceKey: text("source_key").notNull(),
  fromState: text("from_state").$type<SourceSwitchState>().notNull(),
  toState: text("to_state").$type<SourceSwitchState>().notNull(),
  reason: text("reason").notNull().default(""),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Editable provider prices so the calculator and ledger need no deploy to change. */
export const providerPrice = pgTable(
  "provider_price",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    action: text("action").notNull(),
    unitCostUsd: numeric("unit_cost_usd", { precision: 12, scale: 6 }).notNull(),
    unit: text("unit").notNull().default("request"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .defaultNow()
      .notNull(),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("provider_price_uidx").on(
      table.provider,
      table.action,
      table.effectiveFrom,
    ),
  ],
);

export const costBillableValues = ["platform", "workspace_credits"] as const;
export type CostBillable = (typeof costBillableValues)[number];

/** One row per outbound provider call. Feeds budgets, credits and the public ledger. */
export const costEvent = pgTable(
  "cost_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    workspaceId: uuid("workspace_id").references(() => workspace.id, {
      onDelete: "set null",
    }),
    sourceKey: text("source_key").notNull(),
    provider: text("provider").notNull(),
    action: text("action").notNull(),
    units: numeric("units", { precision: 14, scale: 4 }).notNull().default("1"),
    unitCostUsd: numeric("unit_cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    billableTo: text("billable_to")
      .$type<CostBillable>()
      .notNull()
      .default("platform"),
    requestRef: text("request_ref"),
    ok: boolean("ok").notNull().default(true),
  },
  (table) => [
    index("cost_event_ts_idx").on(table.ts),
    index("cost_event_workspace_ts_idx").on(table.workspaceId, table.ts),
  ],
);

/** Daily rollup of cost_event: what each source/provider/action cost per UTC day. */
export const costDaily = pgTable(
  "cost_daily",
  {
    day: date("day").notNull(),
    sourceKey: text("source_key").notNull(),
    provider: text("provider").notNull(),
    action: text("action").notNull(),
    calls: integer("calls").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    failed: integer("failed").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.day, table.sourceKey, table.provider, table.action],
    }),
  ],
);

/** Public, workspace-independent posts (e.g. the shared Reddit sweep). */
export const sharedPost = pgTable(
  "shared_post",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").$type<SourcePlatform>().notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    community: text("community"),
    title: text("title"),
    body: text("body").notNull().default(""),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    contentHash: text("content_hash").notNull(),
    provider: text("provider").notNull(),
  },
  (table) => [
    uniqueIndex("shared_post_platform_external_uidx").on(
      table.platform,
      table.externalId,
    ),
    index("shared_post_community_posted_idx").on(
      table.platform,
      table.community,
      table.postedAt,
    ),
  ],
);

export const sweepStateValues = ["running", "ok", "partial", "failed"] as const;
export type SweepState = (typeof sweepStateValues)[number];

export const sharedSweepRun = pgTable("shared_sweep_run", {
  id: uuid("id").defaultRandom().primaryKey(),
  platform: text("platform").$type<SourcePlatform>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  communitiesOk: integer("communities_ok").notNull().default(0),
  communitiesFailed: integer("communities_failed").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  state: text("state").$type<SweepState>().notNull().default("running"),
});

/**
 * Public endpoint guard (S06). `budget_day` is the global daily dollar budget
 * for unauthenticated, cost-bearing routes; `public_visitor` counts scans per
 * salted visitor hash per day (raw IPs are never stored).
 */
export const budgetDay = pgTable("budget_day", {
  day: date("day").primaryKey(),
  spentUsd: numeric("spent_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  capUsd: numeric("cap_usd", { precision: 12, scale: 6 }).notNull(),
});

export const publicVisitor = pgTable(
  "public_visitor",
  {
    visitorHash: text("visitor_hash").notNull(),
    day: date("day").notNull(),
    scans: integer("scans").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.visitorHash, table.day] })],
);

export type SourceSwitchRow = typeof sourceSwitch.$inferSelect;
export type CostEventInsert = typeof costEvent.$inferInsert;
export type SharedPostInsert = typeof sharedPost.$inferInsert;


/**
 * S05 plans and entitlements. Limits are data (edit with SQL, no deploy).
 * `workspace.plan` selects the row set; a missing key falls back to the `free` plan.
 */
export const planLimit = pgTable(
  "plan_limit",
  {
    plan: text("plan").notNull(),
    key: text("key").notNull(),
    value: integer("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.plan, table.key] })],
);

/**
 * Metered usage. `period` is the UTC day for per-day counters (scored_leads) and the
 * first UTC day of the month for per-month counters (deep_searches).
 */
export const workspaceUsage = pgTable(
  "workspace_usage",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    period: date("period", { mode: "string" }).notNull(),
    scoredLeads: integer("scored_leads").notNull().default(0),
    deepSearches: integer("deep_searches").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.period] })],
);

/**
 * S72 plays: a typed, recommended go-to-market action for an opportunity.
 * Vantage only recommends; a human performs the action.
 */
export const playKindEnum = pgEnum("play_kind", [
  "reply_brief",
  "directory_submission",
  "comparison_page",
  "migration_guide",
  "importer",
  "integration",
  "outreach",
  "trial_offer",
  "newsletter_pitch",
]);

export const playStatusEnum = pgEnum("play_status", [
  "suggested",
  "accepted",
  "done",
  "dismissed",
]);

export const playEffortEnum = pgEnum("play_effort", ["s", "m", "l"]);

export const play = pgTable(
  "play",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunity.id, {
      onDelete: "cascade",
    }),
    /** Plain column for now: the `destination` table lands in S75, which adds the foreign key. */
    destinationId: uuid("destination_id"),
    kind: playKindEnum("kind").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull().default(""),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: playStatusEnum("status").notNull().default("suggested"),
    effortEstimate: playEffortEnum("effort_estimate").notNull().default("m"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (table) => [
    index("play_workspace_opportunity_idx").on(
      table.workspaceId,
      table.opportunityId,
    ),
  ],
);

export type Play = typeof play.$inferSelect;
export type NewPlay = typeof play.$inferInsert;
