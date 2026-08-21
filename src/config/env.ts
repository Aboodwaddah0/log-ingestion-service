import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT) || 8080,

  POSTGRES_HOST: process.env.POSTGRES_HOST ?? "localhost",
  POSTGRES_PORT: Number(process.env.POSTGRES_PORT) || 5432,
  POSTGRES_USER: process.env.POSTGRES_USER ?? "postgres",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "postgres",
  POSTGRES_DB: process.env.POSTGRES_DB ?? "logs",
  
  RETENTION_DAYS: Number(process.env.RETENTION_DAYS) || 30,
  RETENTION_INTERVAL_MINUTES: Number(process.env.RETENTION_INTERVAL_MINUTES) || 60,


  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || undefined,
  ALERT_ERROR_THRESHOLD: Number(process.env.ALERT_ERROR_THRESHOLD) || 50,
  ALERT_WINDOW_MINUTES: Number(process.env.ALERT_WINDOW_MINUTES) || 5,
  ALERT_CHECK_INTERVAL_MINUTES: Number(process.env.ALERT_CHECK_INTERVAL_MINUTES) || 1,

  // Off unless explicitly set to "true" — gzip costs CPU on every response,
  // and the app container only has 0.5 of a core.
  COMPRESSION_ENABLED: process.env.COMPRESSION_ENABLED === "true",
};

// The oldest timestamp the service can actually store. `logs` is partitioned by
// month and retention drops any partition ending at or before the cutoff, so the
// floor is the start of the month *containing* the cutoff — the oldest month
// that survives a retention pass.
//
// Validation and partition creation both derive from this, deliberately: if the
// validator accepted anything older, the row would pass validation and then hit
// "no partition of relation" at COPY time, failing the entire group-commit batch
// (including other clients' valid logs). If partition creation went any older,
// retention would drop those partitions and the next cycle would recreate them,
// forever.
export function retentionFloor(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime() - env.RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 1));
}
