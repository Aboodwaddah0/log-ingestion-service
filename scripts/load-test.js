import fetch from "node-fetch";
import http from "http";

const URL = `http://127.0.0.1:${process.env.PORT ?? 4000}/logs`;

const TOTAL_LOGS = 200000;
const BATCH_SIZE = 5000;
const CONCURRENCY = 5;


const levels = [
  "debug",
  "info",
  "warn",
  "error",
];

const services = [
  "auth",
  "checkout",
  "payment",
  "notification",
  "inventory",
];


const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY,
});


function generateLogs(count) {

  const logs = new Array(count);

  for (let i = 0; i < count; i++) {

    logs[i] = {
      timestamp: new Date().toISOString(),

      level:
        levels[
          Math.floor(Math.random() * levels.length)
        ],

      service:
        services[
          Math.floor(Math.random() * services.length)
        ],

      message: `Test log message ${i}`,

      attributes: {
        user_id: String(i),
        region: "eu-west",
        retries: Math.floor(Math.random() * 5),
      },
    };
  }

  return logs;
}



async function sendBatch(logs) {

  const response = await fetch(URL, {

    method: "POST",

    agent,

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      logs,
    }),

  });


  if (!response.ok) {

    const text = await response.text();

    throw new Error(
      `HTTP ${response.status}: ${text}`
    );
  }


  return response.json();
}




async function run() {


  console.log("Generating logs...");


  const batches = [];


  for (
    let i = 0;
    i < TOTAL_LOGS;
    i += BATCH_SIZE
  ) {

    batches.push(
      generateLogs(
        Math.min(
          BATCH_SIZE,
          TOTAL_LOGS - i
        )
      )
    );

  }


  console.log("-------------------");
  console.log(`Total logs: ${TOTAL_LOGS}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Batches: ${batches.length}`);
  console.log(`Workers: ${CONCURRENCY}`);
  console.log("-------------------");



  let sent = 0;


  const start = Date.now();



  async function worker() {


    while (batches.length > 0) {


      const batch = batches.shift();


      await sendBatch(batch);


      sent += batch.length;


      if (sent % 50000 === 0) {

        console.log(
          `Sent ${sent}/${TOTAL_LOGS}`
        );

      }

    }

  }



  const workers = [];


  for (
    let i = 0;
    i < CONCURRENCY;
    i++
  ) {

    workers.push(
      worker()
    );

  }



  await Promise.all(workers);



  const end = Date.now();


  const seconds =
    (end - start) / 1000;



  console.log("-------------------");

  console.log(
    `Time: ${seconds.toFixed(3)}s`
  );


  console.log(
    `Throughput: ${(sent / seconds).toFixed(2)} logs/sec`
  );


}



run()
.catch(err => {

  console.error(err);

  process.exit(1);

});