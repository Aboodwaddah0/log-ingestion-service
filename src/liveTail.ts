import { EventEmitter } from "node:events";
import type { InsertLog, LogQuery } from "./repositories/log.repository.js";

// Push, not poll: log.repository.ts's runFlush() publishes here once per
// flush (not per row) right after a batch is durably committed. When nobody
// is tailing, this is a single emit() over zero listeners — no DB polling,
// no per-log work, ever.
const emitter = new EventEmitter();
const FLUSH_EVENT = "flush";

// EventEmitter warns past 10 listeners by default; a real cap is enforced by
// the controller via LIVE_TAIL_MAX_CLIENTS, this just silences the default
// warning at a number comfortably above any sane cap.
emitter.setMaxListeners(100);

export function publishToTail(logs: InsertLog[]): void {
  emitter.emit(FLUSH_EVENT, logs);
}

export function getTailClientCount(): number {
  return emitter.listenerCount(FLUSH_EVENT);
}

export type TailFilter = Pick<LogQuery, "service" | "level" | "q" | "attrs">;

// Direct JS equivalent of the SQL conditions in getLogs (log.repository.ts).
// Simpler than attrCondition's 3-way typed OR there: that exists only to route
// around Postgres's type-strict @> containment operator, which JS has no
// equivalent constraint for — a single String() coercion is exactly the same
// comparison.
function matchesFilter(log: InsertLog, filter: TailFilter): boolean {
  if (filter.service && log.service !== filter.service) return false;
  if (filter.level && log.level !== filter.level) return false;
  if (filter.q && !log.message.toLowerCase().includes(filter.q.toLowerCase())) return false;
  if (filter.attrs) {
    for (const [key, value] of Object.entries(filter.attrs)) {
      if (String(log.attributes?.[key]) !== value) return false;
    }
  }
  return true;
}

export function subscribeTail(filter: TailFilter, onLog: (log: InsertLog) => void): () => void {
  const listener = (logs: InsertLog[]) => {
    for (const log of logs) {
      if (matchesFilter(log, filter)) onLog(log);
    }
  };
  emitter.on(FLUSH_EVENT, listener);
  return () => emitter.off(FLUSH_EVENT, listener);
}
