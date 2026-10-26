import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

export const hasGtmTestDatabase = Boolean(process.env.GTM_TEST_DATABASE_URL);
if (process.env.GTM_REQUIRE_INTEGRATION === "1" && !hasGtmTestDatabase) throw new Error("Required GTM Postgres integration database is missing");
export async function gtmPostgresFixture() {
  const raw = process.env.GTM_TEST_DATABASE_URL;
  if (!raw) throw new Error("GTM_TEST_DATABASE_URL must explicitly name the disposable test database");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432" || url.pathname !== "/vantage_gtm_test" || url.username !== "vantage_test" || url.search || url.hash) throw new Error("Refusing non-disposable GTM database");
  const client = postgres(raw, { max: 8, fetch_types: false });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  // Exercise the identical SQL and ordered transaction boundaries emitted by Neon's batch adapter.
  const adapter = new Proxy(db, { get(target, key) {
    if (key === "batch") return (queries: Array<{ getQuery(): { sql: string; params: unknown[] } }>) => client.begin(async tx => {
      const rows = [];
      for (const query of queries) { const built = query.getQuery(); rows.push(await tx.unsafe(built.sql, built.params as never[])); }
      return rows;
    });
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const workspaces: string[] = [];
  return { db: adapter, client,
    async seed() {
      const workspaceId = crypto.randomUUID(), conversationId = crypto.randomUUID();
      await client`insert into workspace (id, name, owner_user_id) values (${workspaceId}, 'GTM disposable fixture', 'gtm-test-owner')`;
      workspaces.push(workspaceId);
      await client`insert into seo_conversation (id, workspace_id) values (${conversationId}, ${workspaceId})`;
      return { workspaceId, conversationId };
    },
    async close() { for (const id of workspaces) await client`delete from workspace where id = ${id}`; await client.end(); },
  };
}
