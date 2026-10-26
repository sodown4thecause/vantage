import { createContentDraft, type ContentDraftRow } from "./repository";
import type { ContentBrandVoiceProfile, ContentDraftInput } from "./contracts";
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
}): Promise<ContentDraftRow> {
  if (!args.profile) throw new ContentBrandVoiceRequiredError();
  const body = await humaniseContentDraft({
    workspaceId: args.workspaceId,
    draft: args.draft,
    profile: args.profile,
    models: args.models,
  });
  return createContentDraft({
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    ...contentDraftInputSchema.parse({ ...args.draft, body }),
  });
}
