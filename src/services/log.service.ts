import { type InsertLog, insertLogs } from "../repositories/log.repository.js";
import { logSchema } from "../validators/log.schema.js";


const BATCH_SIZE = 5000;


export async function ingestLogs(logs: unknown[]) {

    let acceptedCount = 0;

    const rejected: Array<{
        index: number;
        reason: string;
        log: unknown;
    }> = [];


    let batch: InsertLog[] = [];


    for (const [index, item] of logs.entries()) {


        const result = logSchema.safeParse(item);


        if (result.success) {


            batch.push(result.data);

            acceptedCount++;


            if (batch.length >= BATCH_SIZE) {


                await insertLogs(batch);


                batch = [];

            }


        } else {


            rejected.push({
                index,
                reason:
                    result.error.issues[0]?.message
                    ?? "Invalid log",
                log: item
            });


        }

    }


    // إدخال آخر batch إذا بقي شيء
    if (batch.length > 0) {

        await insertLogs(batch);

    }


    return {
        accepted: acceptedCount,
        rejected
    };

}