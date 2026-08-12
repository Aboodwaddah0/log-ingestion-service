import fetch from "node-fetch";
import http from "http";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const BASE = `http://127.0.0.1:${process.env.PORT ?? 8080}`;

const DURATION_MS   = Number(process.env.DURATION_MS ?? 30_000);
const WRITE_WORKERS = Number(process.env.WRITE_WORKERS ?? 5);
const READ_WORKERS  = Number(process.env.READ_WORKERS ?? 5);
const WRITE_BATCH   = Number(process.env.WRITE_BATCH ?? 2_000);
const USER_POOL     = 10_000; // shared id space so reads sometimes hit real rows

const levels   = ["debug", "info", "warn", "error"];
const services = ["auth", "checkout", "payment", "notification", "inventory"];

const agent = new http.Agent({ keepAlive: true, maxSockets: WRITE_WORKERS + READ_WORKERS });

function makeBatch(n) {
  const logs = new Array(n);
  for (let i = 0; i < n; i++) {
    logs[i] = {
      timestamp:  new Date().toISOString(),
      level:      levels[Math.floor(Math.random() * levels.length)],
      service:    services[Math.floor(Math.random() * services.length)],
      message:    `Mixed load test message ${Math.random().toString(36).slice(2)}`,
      attributes: {
        user_id: String(Math.floor(Math.random() * USER_POOL)),
        region:  "eu-west",
        retries: Math.floor(Math.random() * 5),
      },
    };
  }
  return logs;
}

async function requestJson(url, opts) {
  const t0 = Date.now();
  const res = await fetch(url, { agent, ...opts });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, ms, status: res.status, body };
  }
  await res.json();
  return { ok: true, ms, status: res.status };
}

// ── write side ───────────────────────────────────────────────────────────────

const writeStats = { sent: 0, errors: 0, errorSamples: [] };

async function writeWorker(deadline) {
  while (Date.now() < deadline) {
    const batch = makeBatch(WRITE_BATCH);
    const r = await requestJson(`${BASE}/logs`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ logs: batch }),
    });
    if (r.ok) {
      writeStats.sent += WRITE_BATCH;
    } else {
      writeStats.errors++;
      if (writeStats.errorSamples.length < 3) writeStats.errorSamples.push(`${r.status}: ${r.body}`);
    }
  }
}

// ── read side ────────────────────────────────────────────────────────────────

const readStats = { ok: 0, errors: 0, latencies: [], errorSamples: [] };

function randomReadUrl() {
  if (Math.random() < 0.5) {
    const userId = Math.floor(Math.random() * USER_POOL);
    return `${BASE}/logs?attr.user_id=${userId}&limit=50`;
  }
  const until = new Date();
  const since = new Date(until.getTime() - 60 * 60 * 1000);
  return `${BASE}/logs/aggregate?since=${since.toISOString()}&until=${until.toISOString()}&bucket=1m&group_by=service`;
}

async function readWorker(deadline) {
  while (Date.now() < deadline) {
    const r = await requestJson(randomReadUrl(), { method: "GET" });
    if (r.ok) {
      readStats.ok++;
      readStats.latencies.push(r.ms);
    } else {
      readStats.errors++;
      if (readStats.errorSamples.length < 3) readStats.errorSamples.push(`${r.status}: ${r.body}`);
    }
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log("===========================================");
  console.log(` Mixed read+write load test`);
  console.log(`  Duration      : ${DURATION_MS / 1000}s`);
  console.log(`  Write workers : ${WRITE_WORKERS}  (batch ${WRITE_BATCH})`);
  console.log(`  Read workers  : ${READ_WORKERS}  (50/50 attr-filter vs aggregate)`);
  console.log("===========================================");

  const start = Date.now();
  const deadline = start + DURATION_MS;

  await Promise.all([
    ...Array.from({ length: WRITE_WORKERS }, () => writeWorker(deadline)),
    ...Array.from({ length: READ_WORKERS }, () => readWorker(deadline)),
  ]);

  const seconds = (Date.now() - start) / 1000;

  console.log("-------------------------------------------");
  console.log(`  Write throughput : ${(writeStats.sent / seconds).toFixed(0)} logs/sec  (${writeStats.sent} sent, ${writeStats.errors} failed batches)`);
  if (writeStats.errorSamples.length) console.log(`  Write errors      : ${writeStats.errorSamples.join(" | ")}`);
  console.log(`  Read requests    : ${readStats.ok} ok, ${readStats.errors} failed`);
  console.log(`  Read latency ms  : avg ${(readStats.latencies.reduce((a, b) => a + b, 0) / (readStats.latencies.length || 1)).toFixed(0)}  p95 ${percentile(readStats.latencies, 95).toFixed?.(0) ?? "n/a"}  max ${Math.max(0, ...readStats.latencies)}`);
  if (readStats.errorSamples.length) console.log(`  Read errors       : ${readStats.errorSamples.join(" | ")}`);
  console.log("===========================================");
}

main().catch((err) => { console.error(err); process.exit(1); });
