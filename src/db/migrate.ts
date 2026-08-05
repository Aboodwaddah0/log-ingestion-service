import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    // Create tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Get already-applied migrations
    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename"
    );
    const applied = new Set(rows.map((r) => r.filename));

    // Read all SQL files in order
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");

      // Run each migration in its own transaction
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`[migrate] applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("[migrate] all migrations up to date");
  } finally {
    client.release();
  }
}
