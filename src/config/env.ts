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
};
