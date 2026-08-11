import app from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { ensurePartitions, startRetentionJob } from "./db/retention.js";
import { drainBuffer } from "./repositories/log.repository.js";
async function startup() {
    await pool.query("SELECT 1");
    console.log("Database connection established");
    await runMigrations();
    await ensurePartitions();
    startRetentionJob();
    const server = app.listen(env.PORT, "0.0.0.0", () => {
        console.log(`Server listening on port ${env.PORT}`);
    });
    async function shutdown(signal) {
        console.log(`[shutdown] ${signal} received`);
        server.close();
        await drainBuffer();
        await pool.end();
        process.exit(0);
    }
    process.on("SIGTERM", () => shutdown("SIGTERM").catch(console.error));
    process.on("SIGINT", () => shutdown("SIGINT").catch(console.error));
}
startup().catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
});
