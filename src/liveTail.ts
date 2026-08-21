import { EventEmitter } from "node:events";
import type { InsertLog, LogQuery } from "./repositories/log.repository.js";


const emitter = new EventEmitter();
const FLUSH_EVENT = "flush";


emitter.setMaxListeners(100);

export function publishToTail(logs: InsertLog[]): void {
  emitter.emit(FLUSH_EVENT, logs);
}

export function getTailClientCount(): number {
  return emitter.listenerCount(FLUSH_EVENT);
}

export type TailFilter = Pick<LogQuery, "service" | "level" | "q" | "attrs">;


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
