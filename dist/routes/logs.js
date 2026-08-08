import { Router } from "express";
import { postLogs, getLogsHandler } from "../controllers/log.controller.js";
const router = Router();
router.post("/logs", postLogs);
router.get("/logs", getLogsHandler);
export default router;
