import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("Налаштуйте DATABASE_URL перед запуском міграції.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const folder = new URL("../db/", import.meta.url);
  const migrations = (await readdir(folder)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(167112799)");
  for (const migration of migrations) {
    await client.query(await readFile(new URL(migration, folder), "utf8"));
  }
  await client.query("COMMIT");
  console.log("База Betbook готова.");
} finally {
  await client.end();
}
