/** Fewer documents than this read means the sources, not the topics, are the likely cause of an empty result. */
export const FEW_DOCUMENTS_READ = 50;

export type NothingStrongReason = "few_sources" | "topics_too_narrow";

export function nothingStrongReason(read: number): NothingStrongReason {
  return read < FEW_DOCUMENTS_READ ? "few_sources" : "topics_too_narrow";
}

/** True only on the poll that sees a scan leave the queued or running state, so a page opened after completion does not reload. */
export function scanJustFinished(wasActive: boolean, status: string | undefined): boolean {
  return wasActive && (status === "done" || status === "partial");
}
