import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("Налаштуйте DATABASE_URL перед скиданням лічильників.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const result = await client.query(
    "INSERT INTO help_statistics_reset DEFAULT VALUES ON CONFLICT DO NOTHING RETURNING started_at"
  );
  console.log(result.rowCount === 1 ? "Лічильники скинуто." : "Лічильники вже скинуто.");
} finally {
  await client.end();
}
