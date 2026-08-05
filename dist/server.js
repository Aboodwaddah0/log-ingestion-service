import app, { setReady } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
async function startup() {
    // Test database connection
    await pool.query("SELECT 1");
    console.log("Database connection established");
    // Run migrations
    await runMigrations();
    // Mark service ready
    setReady();
    console.log("Service is ready");
    // Start HTTP server only after everything is ready
    app.listen(env.PORT, () => {
        console.log(`Server listening on port ${env.PORT}`);
    });
}
startup().catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
});
