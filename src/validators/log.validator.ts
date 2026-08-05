import { logSchema } from "./log.schema.js";


export function validateLog(data: unknown){

    return logSchema.safeParse(data);

}