import { createContentDraft, type ContentDraftRow } from "./repository";
import type { ContentBrandVoiceProfile, ContentDraftInput, ContentSourceCitation } from "./contracts";
import { contentDraftInputSchema } from "./contracts";
import { humaniseContentDraft } from "./humaniser";
import type { ContentAgentModels } from "./models";

export class ContentBrandVoiceRequiredError extends Error {
  readonly code = "CONTENT_BRAND_VOICE_REQUIRED";

  constructor() {
    super("Save a brand voice profile before creating a draft.");
    this.name = "ContentBrandVoiceRequiredError";
  }
}

export async function createHumanisedContentDraft(args: {
  workspaceId: string;
  threadId: string;
  draft: ContentDraftInput;
  profile: ContentBrandVoiceProfile | null;
  models: ContentAgentModels;
  signal?: AbortSignal;
  finalizeBody?: (body: string) => string;
  sourceCitations?: ContentSourceCitation[];
}): Promise<ContentDraftRow> {
  if (!args.profile) throw new ContentBrandVoiceRequiredError();
  const draft = contentDraftInputSchema.parse(args.draft);
  args.signal?.throwIfAborted();
  const humanisedBody = await humaniseContentDraft({
    workspaceId: args.workspaceId,
    draft,
    profile: args.profile,
    models: args.models,
    signal: args.signal,
  });
  args.signal?.throwIfAborted();
  const body = args.finalizeBody ? args.finalizeBody(humanisedBody) : humanisedBody;
  return createContentDraft({
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    ...contentDraftInputSchema.parse({ ...draft, body }),
    sourceCitations: args.sourceCitations ?? [],
  });
}
