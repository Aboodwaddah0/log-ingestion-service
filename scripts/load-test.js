import fetch from "node-fetch";
import http from "http";

const URL = `http://127.0.0.1:${process.env.PORT ?? 8080}/logs`;

const TOTAL_LOGS  = 200_000;
const BATCH_SIZE  = 5_000;
const CONCURRENCY = 5;
const RUNS        = Number(process.env.RUNS ?? 3);

const levels   = ["debug", "info", "warn", "error"];
const services = ["auth", "checkout", "payment", "notification", "inventory"];

const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

function generateBatches() {
  const batches = [];
  for (let i = 0; i < TOTAL_LOGS; i += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, TOTAL_LOGS - i);
    const logs  = new Array(count);
    for (let j = 0; j < count; j++) {
      logs[j] = {
        timestamp:  new Date().toISOString(),
        level:      levels[Math.floor(Math.random() * levels.length)],
        service:    services[Math.floor(Math.random() * services.length)],
        message:    `Test log message ${i + j}`,
        attributes: { user_id: String(i + j), region: "eu-west", retries: Math.floor(Math.random() * 5) },
      };
    }
    batches.push(logs);
  }
  return batches;
}

async function sendBatch(logs) {
  const res = await fetch(URL, {
    method:  "POST",
    agent,
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ logs }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runOnce(run) {
  const batches = generateBatches();
  let sent = 0;

  const queue = [...batches];

  async function worker() {
    while (queue.length > 0) {
      const batch = queue.shift();
      await sendBatch(batch);
      sent += batch.length;
    }
  }

  const start = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seconds = (Date.now() - start) / 1000;
  const throughput = sent / seconds;

  console.log(`  Run ${run}: ${seconds.toFixed(3)}s  →  ${throughput.toFixed(0)} logs/sec`);
  return { seconds, throughput };
}

async function main() {
  console.log("===========================================");
  console.log(` Load test  ·  ${RUNS} runs`);
  console.log(`  Total logs : ${TOTAL_LOGS.toLocaleString()}`);
  console.log(`  Batch size : ${BATCH_SIZE.toLocaleString()}`);
  console.log(`  Workers    : ${CONCURRENCY}`);
  console.log("===========================================");

  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    results.push(await runOnce(i));
  }

  const times       = results.map(r => r.seconds);
  const throughputs = results.map(r => r.throughput);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = arr => Math.min(...arr);
  const max = arr => Math.max(...arr);

  console.log("-------------------------------------------");
  console.log(`  Time       avg ${avg(times).toFixed(3)}s  min ${min(times).toFixed(3)}s  max ${max(times).toFixed(3)}s`);
  console.log(`  Throughput avg ${avg(throughputs).toFixed(0)}  min ${min(throughputs).toFixed(0)}  max ${max(throughputs).toFixed(0)}  logs/sec`);
  console.log("===========================================");
}

main().catch(err => { console.error(err); process.exit(1); });
