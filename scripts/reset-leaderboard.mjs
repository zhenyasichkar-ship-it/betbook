import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("Налаштуйте DATABASE_URL перед скиданням рейтингу.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("LOCK TABLE players IN EXCLUSIVE MODE");
  const reset = await client.query(
    "WITH reset AS (INSERT INTO leaderboard_resets (name, started_at) VALUES ('manual-deposits', clock_timestamp()) " +
    "ON CONFLICT DO NOTHING RETURNING name) " +
    "UPDATE players SET season_start_net = game_net, season_start_rounds = completed_rounds " +
    "WHERE EXISTS (SELECT 1 FROM reset)"
  );
  const result = await client.query(
    "SELECT count(*)::int AS entries FROM players WHERE telegram_id > 0 AND completed_rounds > season_start_rounds"
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ snapshotRows: reset.rowCount, entries: result.rows[0].entries }));
} finally {
  await client.end();
}
