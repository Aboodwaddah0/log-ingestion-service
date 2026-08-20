import { pool } from "./db/pool.js";
import { env } from "./config/env.js";

let firing = false;

interface WebhookPayload {
  alert: "error_threshold_exceeded";
  status: "firing" | "resolved";
  threshold: number;
  window_minutes: number;
  error_count: number;
  timestamp: string;
  content: string;
  text: string;
}

function buildPayload(status: "firing" | "resolved", errorCount: number): WebhookPayload {
  const summary =
    status === "firing"
      ? `🚨 Error threshold exceeded: ${errorCount} errors in the last ${env.ALERT_WINDOW_MINUTES}m (threshold: ${env.ALERT_ERROR_THRESHOLD})`
      : `✅ Resolved: ${errorCount} errors in the last ${env.ALERT_WINDOW_MINUTES}m (threshold: ${env.ALERT_ERROR_THRESHOLD})`;

  return {
    alert: "error_threshold_exceeded",
    status,
    threshold: env.ALERT_ERROR_THRESHOLD,
    window_minutes: env.ALERT_WINDOW_MINUTES,
    error_count: errorCount,
    timestamp: new Date().toISOString(),
    content: summary,
    text: summary,
  };
}

async function sendWebhook(payload: WebhookPayload): Promise<void> {
  try {
    const res = await fetch(env.ALERT_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[alerting] webhook returned ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("[alerting] webhook delivery failed:", err);
  }
}

async function checkThreshold(): Promise<void> {
  const cutoff = new Date(Date.now() - env.ALERT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const result = await pool.query<{ error_count: string | null }>(
    `SELECT SUM(count) AS error_count
     FROM logs_agg_1m
     WHERE level = 'error' AND bucket_start >= $1::timestamptz`,
    [cutoff]
  );

  const errorCount = Number(result.rows[0]?.error_count ?? 0);
  const breached = errorCount > env.ALERT_ERROR_THRESHOLD;

  if (breached && !firing) {
    firing = true;
    console.log(`[alerting] threshold breached: ${errorCount} errors in ${env.ALERT_WINDOW_MINUTES}m`);
    await sendWebhook(buildPayload("firing", errorCount));
  } else if (!breached && firing) {
    firing = false;
    console.log(`[alerting] resolved: ${errorCount} errors in ${env.ALERT_WINDOW_MINUTES}m`);
    await sendWebhook(buildPayload("resolved", errorCount));
  }
}

export function startAlertingJob(): void {
  const intervalMs = env.ALERT_CHECK_INTERVAL_MINUTES * 60 * 1000;

  setInterval(() => {
    checkThreshold().catch((err) => {
      console.error("[alerting] check failed:", err);
    });
  }, intervalMs);

  console.log(
    `[alerting] started — every ${env.ALERT_CHECK_INTERVAL_MINUTES}m, ` +
      `threshold ${env.ALERT_ERROR_THRESHOLD} errors / ${env.ALERT_WINDOW_MINUTES}m`
  );
}
