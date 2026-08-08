import { AppError } from "../errors/AppError.js";
import { ingestLogs, queryLogs } from "../services/log.service.js";
import { validateLogQuery } from "../validators/query.validator.js";
export async function postLogs(req, res) {
    if (!req.body || !Array.isArray(req.body.logs)) {
        throw new AppError(400, "request body must be { logs: [...] }");
    }
    const result = await ingestLogs(req.body.logs);
    res.status(result.accepted > 0 ? 200 : 400).json(result);
}
export async function getLogsHandler(req, res) {
    const params = validateLogQuery(req.query);
    const result = await queryLogs(params);
    res.status(200).json(result);
}
