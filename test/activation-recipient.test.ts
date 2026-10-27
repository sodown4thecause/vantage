import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  session: { user: { id: "owner", email: "owner@example.com" } } as { user: { id: string; email: string } } | null,
  row: {} as Record<string, unknown>, scopes: [] as unknown[], mail: vi.fn(), welcome: vi.fn(), insert: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: async () => ({ data: state.session }) } }));
vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspace: async () => null, authorizeWorkspace: vi.fn() }));
vi.mock("@/lib/plans/limits", () => ({ assertCanCreateProject: vi.fn() }));
vi.mock("@/lib/analytics/activation", () => ({ captureActivation: vi.fn() }));
vi.mock("@/lib/email/product", () => ({ sendProductEmail: (...args: unknown[]) => state.mail(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({
  insert: () => ({ values: (value: Record<string, unknown>) => {
    state.insert(value); state.row = { id: "workspace-1", ...value };
    return { returning: async () => [state.row] };
  } }),
  select: (fields: Record<string, { name: string }>) => ({ from: () => ({ where: (scope: unknown) => ({ limit: async () => {
    state.scopes.push(scope);
    return [{ email: fields.email.name === "activation_email" ? state.row.activationEmail : state.row.digestEmail }];
  } }) }) }),
}) }));

import { createWorkspaceForCurrentUser } from "@/lib/db/actions";
import { firstScanEmailChoice, sendFirstScanEmail } from "@/lib/email/activation";

beforeEach(() => {
  state.session = { user: { id: "owner", email: "owner@example.com" } };
  state.row = {}; state.scopes = []; state.mail.mockReset(); state.insert.mockReset();
});

it("persists the signed-in owner's activation address without opting into digests", async () => {
  await createWorkspaceForCurrentUser("Synthetic workspace");
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "owner", activationEmail: "owner@example.com" }));
  expect(state.row.digestEmail).toBeUndefined();
  expect(state.row.digestEnabled).toBeUndefined();
  state.mail.mockClear();
  await sendFirstScanEmail("workspace-1", 0, 49);
  expect(state.mail).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", to: "owner@example.com", once: "first_scan" }));
  expect(new PgDialect().sqlToQuery(state.scopes[0] as Parameters<PgDialect["sqlToQuery"]>[0]).params).toEqual(["workspace-1"]);
});

it("never substitutes a separately configured digest recipient", async () => {
  state.row = { activationEmail: "owner@example.com", digestEmail: "digest@example.com" };
  await sendFirstScanEmail("workspace-1", 2, 100);
  expect(state.mail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com" }));
  state.mail.mockClear();
  state.row.activationEmail = null;
  await sendFirstScanEmail("workspace-1", 2, 100);
  expect(state.mail).not.toHaveBeenCalled();
});

it("does not persist an address for an unauthenticated caller", async () => {
  state.session = null;
  await expect(createWorkspaceForCurrentUser("Synthetic workspace")).rejects.toThrow("Unauthorized");
  expect(state.insert).not.toHaveBeenCalled();
});

it.each([0, 49, 50, 100])("uses documents read (%s), not configured sources, for empty-result advice", (read) => {
  const { text } = firstScanEmailChoice(0, read);
  expect(text).toContain(read < 50 ? "Few sources are configured" : "topics may be too narrow");
});
