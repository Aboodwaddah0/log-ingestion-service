import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000,
});


setInterval(() => {
    console.log({
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
    });
}, 3000);