import type { InsertLog } from "../repositories/log.repository.js";

type ValidationResult =
    | { ok: true; data: InsertLog }
    | { ok: false; reason: string };

const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const NINETY_DAYS_MS  = 90 * 24 * 60 * 60 * 1000;

export function validateLog(item: unknown): ValidationResult {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, reason: "log entry must be an object" };
    }

    const { timestamp, level, service, message, attributes } =
        item as Record<string, unknown>;

    if (typeof timestamp !== "string" || !timestamp) {
        return { ok: false, reason: "timestamp is required" };
    }
    const ts = new Date(timestamp);
    if (isNaN(ts.getTime())) {
        return { ok: false, reason: "invalid timestamp" };
    }
    if (ts.getTime() > Date.now() + FIVE_MINUTES_MS) {
        return { ok: false, reason: "timestamp too far in the future" };
    }
    if (ts.getTime() < Date.now() - NINETY_DAYS_MS) {
        return { ok: false, reason: "timestamp too far in the past" };
    }

    if (typeof level !== "string" || !VALID_LEVELS.has(level)) {
        return { ok: false, reason: `invalid level: '${String(level)}'` };
    }

    if (typeof service !== "string" || service.length === 0) {
        return { ok: false, reason: "service must be a non-empty string" };
    }

    if (typeof message !== "string" || message.length === 0) {
        return { ok: false, reason: "message must be a non-empty string" };
    }

    const attrs: Record<string, string | number | boolean> = {};
    if (attributes !== undefined && attributes !== null) {
        if (typeof attributes !== "object" || Array.isArray(attributes)) {
            return { ok: false, reason: "attributes must be a flat object" };
        }
        for (const [key, val] of Object.entries(
            attributes as Record<string, unknown>
        )) {
            const t = typeof val;
            if (t !== "string" && t !== "number" && t !== "boolean") {
                return {
                    ok: false,
                    reason: `attribute '${key}' must be a string, number, or boolean`,
                };
            }
            attrs[key] = val as string | number | boolean;
        }
    }

    return {
        ok: true,
        data: {
            timestamp,
            level: level as "debug" | "info" | "warn" | "error",
            service,
            message,
            attributes: attrs,
        },
    };
}
