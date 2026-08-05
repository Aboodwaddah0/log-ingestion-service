import { z } from "zod";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const logSchema = z.object({

    timestamp: z.string()
        .refine(
            (v) => !isNaN(new Date(v).getTime()),
            { message: "invalid timestamp" }
        )
        .refine(
            (v) => new Date(v).getTime() <= Date.now() + FIVE_MINUTES_MS,
            { message: "timestamp too far in the future" }
        ),

    level: z.enum(["debug", "info", "warn", "error"], {
        error: (issue) => `invalid level: '${String(issue.input)}'`,
    }),

    service: z.string().min(1, "service must be a non-empty string"),

    message: z.string().min(1, "message must be a non-empty string"),

    attributes: z
        .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean()])
        )
        .optional()
        .default({}),

});

export type LogEntry = z.infer<typeof logSchema>;
