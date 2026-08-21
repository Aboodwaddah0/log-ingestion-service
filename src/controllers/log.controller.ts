import { type Request, type Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { getTailClientCount, subscribeTail } from "../liveTail.js";
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

export async function tailLogsHandler(req: Request, res: Response) {
  const params = validateLogQuery(req.query as Record<string, unknown>);

  if (getTailClientCount() >= env.LIVE_TAIL_MAX_CLIENTS) {
    throw new AppError(503, "too many live-tail connections, retry later");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();


  let backpressured = false;
  const unsubscribe = subscribeTail(
    { service: params.service, level: params.level, q: params.q, attrs: params.attrs },
    (log) => {
      if (backpressured) return;
      const ok = res.write(`data: ${JSON.stringify(log)}\n\n`);
      if (!ok) {
        backpressured = true;
        res.once("drain", () => {
          backpressured = false;
        });
      }
    }
  );

  const heartbeat = setInterval(() => {
    if (!backpressured) res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
