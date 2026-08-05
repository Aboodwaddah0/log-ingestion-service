import { Router } from "express";
import { postLogs } from "../controllers/log.controller.js";

const router = Router();

router.post("/logs", postLogs);

export default router;
