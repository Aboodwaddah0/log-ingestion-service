import compression from "compression";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import logsRouter from "./routes/logs.js";
const app = express();
app.use(cors());
if (env.COMPRESSION_ENABLED) {
    app.use(compression());
}
app.use(express.json({
    limit: "10mb"
}));
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});
app.use(logsRouter);
app.use(errorHandler);
export default app;
