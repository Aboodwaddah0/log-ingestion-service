import { pool } from "./pool.js";
import { env } from "../config/env.js";

// Partition names are computed from our own year/month integers — never from
// user input — so inlining them into SQL is safe.
function partitionName(year: number, month: number): string {
  return `logs_${year}_${String(month + 1).padStart(2, "0")}`;
}

async function createMonthPartition(year: number, month: number): Promise<void> {
  // Use Date.UTC so partition bounds are always UTC midnight, matching how
  // TIMESTAMPTZ is stored — local-time new Date() would be offset on non-UTC hosts.
  const start = new Date(Date.UTC(year, month, 1)).toISOString();
  const end   = new Date(Date.UTC(year, month + 1, 1)).toISOString();
  const name  = partitionName(year, month);

  // DDL does not support bind parameters — values are inlined.
  // start/end come from Date.UTC() with integer inputs, never from user input.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF logs
     FOR VALUES FROM ('${start}') TO ('${end}')`
  );
}

export async function ensurePartitions(): Promise<void> {
  const now = new Date();
  for (let i = 0; i <= 2; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    await createMonthPartition(d.getUTCFullYear(), d.getUTCMonth());
  }
}

export async function dropExpiredPartitions(): Promise<number> {
  const cutoff = new Date(Date.now() - env.RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await pool.query<{ partition_name: string }>(`
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
    WHERE parent.relname = 'logs'
  `);

  let dropped = 0;
  for (const { partition_name } of result.rows) {
    const match = /^logs_(\d{4})_(\d{2})$/.exec(partition_name);
    if (!match) continue;

    const year  = Number(match[1]);
    const month = Number(match[2]) - 1;
    const partitionEnd = new Date(Date.UTC(year, month + 1, 1));

    if (partitionEnd <= cutoff) {
      await pool.query(`DROP TABLE IF EXISTS ${partition_name}`);
      console.log(`[retention] dropped partition ${partition_name}`);
      dropped++;
    }
  }

  return dropped;
}

export function startRetentionJob(): void {
  const intervalMs = env.RETENTION_INTERVAL_MINUTES * 60 * 1000;

  setInterval(async () => {
    try {
      await ensurePartitions();
      const dropped = await dropExpiredPartitions();
      if (dropped > 0) {
        console.log(`[retention] dropped ${dropped} expired partition(s)`);
      }
    } catch (err) {
      console.error("[retention] error:", err);
    }
  }, intervalMs);

  console.log(
    `[retention] started — every ${env.RETENTION_INTERVAL_MINUTES}m, retention ${env.RETENTION_DAYS}d`
  );
}
