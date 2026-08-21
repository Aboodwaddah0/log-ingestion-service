import { type Request, type Response } from "express";
import { AppError } from "../errors/AppError.js";
import { ingestLogs, queryAggregate, queryLogs } from "../services/log.service.js";
import { validateAggregateQuery, validateLogQuery } from "../validators/query.validator.js";

export async function postLogs(req: Request, res: Response) {
  if (!req.body || !Array.isArray(req.body.logs)) {
    throw new AppError(400, "request body must be { logs: [...] }");
  }

  const result = await ingestLogs(req.body.logs);
  res.status(result.accepted > 0 ? 200 : 400).json(result);
}

export async function getLogsHandler(req: Request, res: Response) {
  const params = validateLogQuery(req.query as Record<string, unknown>);
  const result = await queryLogs(params);
  res.status(200).json(result);
}

export async function getLogsAggregateHandler(req: Request, res: Response) {
  const params = validateAggregateQuery(req.query as Record<string, unknown>);
  const result = await queryAggregate(params);
  res.status(200).json(result);
}
