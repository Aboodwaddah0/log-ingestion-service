import { z } from "zod";
export const logSchema = z.object({
    timestamp: z.string()
        .refine((value) => {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            return false;
        }
        return date.getTime() <= Date.now() + (5 * 60 * 1000);
    }, {
        message: "invalid timestamp"
    }),
    level: z.enum([
        "debug",
        "info",
        "warn",
        "error"
    ]),
    service: z.string().min(1),
    message: z.string().min(1),
    attributes: z
        .record(z.string(), z.union([
        z.string(),
        z.number(),
        z.boolean()
    ]))
        .optional()
});
