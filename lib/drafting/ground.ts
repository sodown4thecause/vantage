import { getSemanticMode } from "@/lib/cf/env";
import { embedTexts } from "@/lib/embeddings/embed";
import { deleteVectors, queryVectors, upsertVectors, type VectorItem } from "@/lib/embeddings/store";

/** Upper bound on material vectors per profile; ids 0..63 are the only ones ever written or deleted. */
const MAX_MATERIAL_CHUNKS = 64;
/** Vectorize allows topK up to 50 when metadata is returned. */
const MAX_TOP_K = 50;

type Unit = { text: string; newParagraph: boolean };

function materialVectorId(profileId: string, n: number): string {
  return `material:${profileId}:${n}`;
}

/** Splits oversized text into pieces of at most `size` characters, preferring a space near the cut. */
function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(" ", size);
    if (cut <= 0) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter((piece) => piece !== "");
}

/**
 * Splits text into units no longer than `size`: paragraphs first, then sentences,
 * then hard cuts for any sentence that is still too long.
 */
function toUnits(text: string, size: number): Unit[] {
  const units: Unit[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (trimmed === "") continue;
    const pieces = trimmed.length <= size
      ? [trimmed]
      : trimmed.split(/(?<=[.!?])\s+/).flatMap((sentence) => hardSplit(sentence, size));
    pieces.forEach((text, i) => {
      if (text.trim() !== "") units.push({ text: text.trim(), newParagraph: i === 0 });
    });
  }
  return units;
}

/**
 * Word-boundary tail of a finished chunk, carried into the next chunk so text
 * that straddles a boundary still appears whole in one of them.
 */
function overlapTail(chunk: string, overlap: number): string {
  if (overlap <= 0 || chunk.length <= overlap) return "";
  const tail = chunk.slice(chunk.length - overlap);
  const space = tail.indexOf(" ");
  return (space === -1 ? tail : tail.slice(space + 1)).trim();
}

/**
 * Deterministic chunker for product material. Chunks are at most `size`
 * characters, consecutive chunks share up to `overlap` characters of trailing
 * text, and blank chunks are dropped.
 */
export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = Math.max(1, opts.size ?? 1200);
  const overlap = Math.max(0, Math.min(opts.overlap ?? 150, size - 1));
  const chunks: string[] = [];
  let current = "";
  for (const unit of toUnits(text, size)) {
    if (current === "") {
      current = unit.text;
      continue;
    }
    const separator = unit.newParagraph ? "\n\n" : " ";
    if (current.length + separator.length + unit.text.length <= size) {
      current += separator + unit.text;
      continue;
    }
    chunks.push(current);
    const carry = overlapTail(current, overlap);
    const carried = carry && carry.length + 1 + unit.text.length <= size ? `${carry} ${unit.text}` : unit.text;
    current = carried;
  }
  if (current.trim() !== "") chunks.push(current);
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk !== "");
}

/**
 * Embeds the product material chunks and replaces this profile's material
 * vectors. Upserts first, then deletes the profile's stale tail ids beyond the
 * new chunk count. Returns the number of chunks indexed (0 when unavailable).
 * Never throws.
 */
/**
 * Replaces this profile's material vectors. When `previousProfileId` is given, that version's
 * vectors are deleted too, so superseded material cannot fill the grounding top-K.
 */
export async function indexMaterial(
  workspaceId: string,
  profileId: string,
  text: string,
  signal?: AbortSignal,
  previousProfileId?: string,
): Promise<number> {
  const priorIds = previousProfileId ? staleIds(previousProfileId, 0) : [];
  const chunks = chunkText(text).slice(0, MAX_MATERIAL_CHUNKS);
  if (chunks.length === 0) {
    // A failed cleanup must be retried, not reported as success: throw so the job fails and re-queues.
    const cleared = await deleteVectors(workspaceId, [...staleIds(profileId, 0), ...priorIds]);
    if (!cleared) throw new Error("material vector cleanup failed");
    return 0;
  }
  const vectors = await embedTexts(chunks, { workspaceId, sourceKey: "material-index", signal });
  if (vectors === null) return 0;
  const items: VectorItem[] = vectors.map((values, n) => ({
    id: materialVectorId(profileId, n),
    values,
    kind: "material",
  }));
  const upserted = await upsertVectors(workspaceId, items);
  if (!upserted) return 0;
  // Old-version vectors left behind would crowd this profile out of the top-K, so a failed cleanup is retried.
  const cleaned = await deleteVectors(workspaceId, [...staleIds(profileId, items.length), ...priorIds]);
  if (!cleaned) return 0;
  return items.length;
}

function staleIds(profileId: string, keep: number): string[] {
  return Array.from({ length: MAX_MATERIAL_CHUNKS - keep }, (_, n) => materialVectorId(profileId, n + keep));
}

/**
 * The `k` product-material chunks nearest to the conversation text, best first.
 * Returns null whenever grounding is unavailable (no material, no AI or Vectorize
 * binding, failed call, no matching vectors) so callers keep today's behaviour.
 */
export async function selectGrounding(
  workspaceId: string,
  productMaterialText: string,
  profileId: string,
  threadText: string,
  k = 4,
): Promise<string[] | null> {
  // Mode "off": no grounding, so drafts take the keyword-only path with no AI or Vectorize calls.
  if (getSemanticMode() === "off") return null;
  const chunks = chunkText(productMaterialText).slice(0, MAX_MATERIAL_CHUNKS);
  if (chunks.length === 0 || threadText.trim() === "") return null;
  const embedded = await embedTexts([threadText], { workspaceId, sourceKey: "draft-grounding" });
  const threadVector = embedded?.[0];
  if (!threadVector || threadVector.length === 0) return null;

  const matches = await queryVectors(workspaceId, threadVector, { kind: "material", topK: MAX_TOP_K });
  if (matches === null) return null;
  const prefix = `material:${profileId}:`;
  const picked: string[] = [];
  const seen = new Set<number>();
  for (const match of matches) {
    if (!match.id.startsWith(prefix)) continue;
    const suffix = match.id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const index = Number(suffix);
    if (index >= chunks.length || seen.has(index)) continue;
    seen.add(index);
    picked.push(chunks[index]!);
    if (picked.length >= k) break;
  }
  return picked.length > 0 ? picked : null;
}
