import { pool } from "../db/pool.js";
import { AppError } from "../errors/AppError.js";
import { from as copyFrom } from "pg-copy-streams";


export interface InsertLog {
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    service: string;
    message: string;
    attributes?: Record<string, string | number | boolean>;
}


function escapeCopyValue(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\t/g, "\\t")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
}


function formatLog(log: InsertLog): string {

    return [
        log.timestamp,
        log.level,
        log.service,
        log.message,
        JSON.stringify(log.attributes ?? {})
    ]
        .map(value => escapeCopyValue(String(value)))
        .join("\t");
}



export async function insertLogs(
    logs: InsertLog[]
): Promise<void> {


    if (logs.length === 0) {
        return;
    }


    const client = await pool.connect();


    try {

        const copyQuery = `
            COPY logs
            (
                timestamp,
                level,
                service,
                message,
                attributes
            )
            FROM STDIN
            WITH (
                FORMAT text,
                DELIMITER E'\\t'
            )
        `;


        const copyStream = client.query(
            copyFrom(copyQuery)
        );


        const buffer =
            logs
                .map(formatLog)
                .join("\n") + "\n";



        await new Promise<void>((resolve, reject)=>{


            copyStream.on(
                "finish",
                resolve
            );


            copyStream.on(
                "error",
                reject
            );


            copyStream.end(buffer);


        });


    } catch(error) {


        console.error(
            "COPY failed:",
            error
        );


        throw new AppError(
            500,
            "failed to insert logs"
        );


    } finally {


        client.release();


    }

}