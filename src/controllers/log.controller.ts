import { type Request, type Response } from "express";
import { AppError } from "../errors/AppError.js";
import { ingestLogs } from "../services/log.service.js";


export async function postLogs(req: Request, res: Response) {

    if (!req.body || !Array.isArray(req.body.logs)) {
        throw new AppError(400, "request body must be { logs: [...] }");
    }

    const result = await ingestLogs(req.body.logs);

    const status = result.accepted > 0 ? 200 : 400;

    res.status(status).json(result);

}
