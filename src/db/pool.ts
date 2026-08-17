import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Runaway-query guard, not a latency policy — deliberately generous so it
    // never trips under normal load (Http Error Rate must stay 0.00%). Without
    // this, an abandoned slow query keeps burning the single Postgres CPU and
    // compounds the degradation for every request behind it.
    statement_timeout: 15_000,
});