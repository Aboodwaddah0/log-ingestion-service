// Seeds realistic-looking log data for a demo or a dashboard walkthrough.
//
//   node scripts/seed-demo.js                 # ~12k logs over the last 6 hours
//   HOURS=24 COUNT=40000 node scripts/seed-demo.js
//   PORT=8099 node scripts/seed-demo.js
//
// Writes through the real POST /logs endpoint, so everything it inserts has
// passed the same validation and gone through the same group-commit path as
// production traffic. Safe to run more than once; it only ever adds rows.

import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const PORT = Number(process.env.PORT ?? 8080);
const BASE = `http://127.0.0.1:${PORT}`;
const HOURS = Number(process.env.HOURS ?? 6);
const COUNT = Number(process.env.COUNT ?? 12000);
const BATCH = 500;

const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

// Weighted so the data looks like a real system: mostly info, a little noise,
// errors rare enough that the ones during the incident window below stand out.
const LEVEL_WEIGHTS = [
  ["debug", 0.15],
  ["info", 0.65],
  ["warn", 0.15],
  ["error", 0.05],
];

const REGIONS = ["eu-west-1", "us-east-1", "ap-south-1"];

// Per-service message templates, so GET /logs?q=... and the dashboard's message
// column show something meaningful instead of "message 12345".
const SERVICES = {
  auth: {
    debug: ["token introspection cache hit", "session lookup completed"],
    info: ["user login succeeded", "session refreshed", "user logged out"],
    warn: ["login attempt with expired token", "rate limit approaching for client"],
    error: ["invalid credentials rejected", "token signature verification failed"],
  },
  checkout: {
    debug: ["cart snapshot serialized", "pricing rules evaluated"],
    info: ["order created", "cart updated", "checkout session started"],
    warn: ["cart contained an out-of-stock item", "coupon expired at validation time"],
    error: ["payment declined", "order could not be persisted"],
  },
  payment: {
    debug: ["idempotency key resolved", "gateway routing decided"],
    info: ["charge authorized", "refund issued", "payout scheduled"],
    warn: ["gateway latency above threshold", "retrying charge after soft decline"],
    error: ["gateway timeout", "card issuer rejected the transaction"],
  },
  inventory: {
    debug: ["stock level cache refreshed", "warehouse sync tick"],
    info: ["stock reserved", "stock released", "restock recorded"],
    warn: ["stock level below reorder point", "warehouse sync lagging"],
    error: ["reservation conflict detected", "warehouse sync failed"],
  },
  notification: {
    debug: ["template rendered", "delivery channel selected"],
    info: ["email queued", "push notification sent", "sms delivered"],
    warn: ["delivery retried after soft bounce", "provider quota nearly exhausted"],
    error: ["email delivery failed", "push token no longer valid"],
  },
};

const SERVICE_NAMES = Object.keys(SERVICES);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickLevel(errorBias) {
  // errorBias in [0,1] pushes the roll toward error/warn during the incident.
  if (errorBias > 0 && Math.random() < errorBias) {
    return Math.random() < 0.75 ? "error" : "warn";
  }
  let roll = Math.random();
  for (const [level, weight] of LEVEL_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return level;
  }
  return "info";
}

const now = Date.now();
const windowMs = HOURS * 60 * 60 * 1000;
const start = now - windowMs;

// A single service degrades for ~12% of the window, ending 20% before "now".
// Gives the aggregate chart a visible spike and gives GET /logs?level=error
// something clustered to find, rather than errors smeared evenly everywhere.
const incidentService = "payment";
const incidentEnd = now - windowMs * 0.2;
const incidentStart = incidentEnd - windowMs * 0.12;

function makeLog() {
  // Skew timestamps toward the recent end so a "last 15 minutes" view is not empty.
  const t = start + windowMs * Math.pow(Math.random(), 0.75);
  const service = pick(SERVICE_NAMES);

  const inIncident = service === incidentService && t >= incidentStart && t <= incidentEnd;
  const level = pickLevel(inIncident ? 0.6 : 0);

  const attributes = {
    region: pick(REGIONS),
    user_id: String(1000 + Math.floor(Math.random() * 500)),
    latency_ms: Math.floor(Math.random() * (level === "error" ? 3000 : 400)) + 5,
  };

  if (service === "checkout" || service === "payment") {
    attributes.order_id = `ord_${Math.floor(Math.random() * 90000) + 10000}`;
    attributes.amount_cents = Math.floor(Math.random() * 40000) + 500;
  }
  if (level === "error") {
    attributes.status_code = pick([500, 502, 503, 504]);
    attributes.retryable = Math.random() < 0.5;
  } else {
    attributes.status_code = pick([200, 200, 200, 201, 204]);
  }

  return {
    timestamp: new Date(t).toISOString(),
    level,
    service,
    message: pick(SERVICES[service][level]),
    attributes,
  };
}

async function postBatch(logs) {
  const res = await fetch(`${BASE}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logs }),
    agent,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /logs -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  console.log("===========================================");
  console.log(" Demo data seeder");
  console.log(`  Target   : ${BASE}`);
  console.log(`  Logs     : ${COUNT.toLocaleString("en-US")} over the last ${HOURS}h`);
  console.log(`  Services : ${SERVICE_NAMES.join(", ")}`);
  console.log(`  Incident : ${incidentService} errors spike around ` +
    `${new Date(incidentStart).toLocaleTimeString("en-US")}–${new Date(incidentEnd).toLocaleTimeString("en-US")}`);
  console.log("===========================================");

  try {
    const health = await fetch(`${BASE}/health`, { agent });
    if (!health.ok) throw new Error(`status ${health.status}`);
  } catch (err) {
    console.error(`\nCannot reach ${BASE}/health — is the service running?`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  let accepted = 0;
  let rejected = 0;
  const t0 = Date.now();

  for (let sent = 0; sent < COUNT; sent += BATCH) {
    const size = Math.min(BATCH, COUNT - sent);
    const logs = Array.from({ length: size }, makeLog);
    const result = await postBatch(logs);
    accepted += result.accepted;
    rejected += result.rejected.length;

    if (result.rejected.length > 0) {
      console.log(`  rejected sample: ${JSON.stringify(result.rejected[0])}`);
    }
    process.stdout.write(`\r  seeded ${Math.min(sent + size, COUNT).toLocaleString("en-US")} / ${COUNT.toLocaleString("en-US")}`);
  }

  const seconds = (Date.now() - t0) / 1000;
  console.log(`\n-------------------------------------------`);
  console.log(`  accepted : ${accepted.toLocaleString("en-US")}`);
  console.log(`  rejected : ${rejected.toLocaleString("en-US")}`);
  console.log(`  took     : ${seconds.toFixed(1)}s`);
  console.log(`-------------------------------------------`);
  console.log("Try:");
  console.log(`  curl "${BASE}/logs?level=error&limit=5"`);
  console.log(`  curl "${BASE}/logs?service=${incidentService}&level=error&limit=5"`);
  console.log(`  curl "${BASE}/logs?attr.region=eu-west-1&limit=5"`);
  console.log(`  curl "${BASE}/logs?q=declined&limit=5"`);
  const since = new Date(start).toISOString();
  const until = new Date(now + 60_000).toISOString();
  console.log(`  curl "${BASE}/logs/aggregate?since=${since}&until=${until}&bucket=5m&group_by=level"`);
  console.log("\nDashboard: cd dashboard && npm run dev");
}

main().catch((err) => {
  console.error("\nseed failed:", err.message);
  process.exit(1);
});
