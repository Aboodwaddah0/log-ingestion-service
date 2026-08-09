import { Router } from "express";
import { getLogsAggregateHandler, getLogsHandler, postLogs } from "../controllers/log.controller.js";

const router = Router();

router.post("/logs", postLogs);
router.get("/logs/aggregate", getLogsAggregateHandler);
router.get("/logs", getLogsHandler);

export default router;
