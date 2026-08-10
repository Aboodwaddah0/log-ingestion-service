import app from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";

async function startup() {
    await pool.query("SELECT 1");
    console.log("Database connection established");

    await runMigrations();

    app.listen(env.PORT, "0.0.0.0", () => {
        console.log(`Server listening on port ${env.PORT}`);
    });
}

startup().catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
});