import {
  type AggregateQuery,
  type InsertLog,
  type LogQuery,
  aggregateLogs,
  insertLogs,
  getLogs,
} from "../repositories/log.repository.js";
import { validateLog } from "../validators/log.schema.js";

export async function ingestLogs(raw: unknown[]) {
  const accepted: InsertLog[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < raw.length; i++) {
    const result = validateLog(raw[i]);
    if (result.ok) {
      accepted.push(result.data);
    } else {
      rejected.push({ index: i, reason: result.reason });
    }
  }

  if (accepted.length > 0) {
    await insertLogs(accepted);
  }

  return { accepted: accepted.length, rejected };
}

export async function queryLogs(params: LogQuery) {
  return getLogs(params);
}

export async function queryAggregate(params: AggregateQuery) {
  return aggregateLogs(params);
}
