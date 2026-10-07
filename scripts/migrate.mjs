// Applies migrations/*.sql to Neon using the serverless HTTP driver.
// Usage: DATABASE_URL=postgres://... npm run migrate
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = neon(databaseUrl);

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("no .sql migrations found");
  process.exit(1);
}

for (const file of files) {
  const contents = await readFile(join(migrationsDir, file), "utf8");
  // Split on statement boundaries is unsafe for DO blocks; our migrations are
  // plain DDL so a single exec of the whole file is fine.
  await sql.query(contents);
  console.log(`applied ${file}`);
}
console.log("migrations complete");
