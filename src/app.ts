import cors from "cors";
import express, { type Request, type Response } from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import logsRouter from "./routes/logs.js";

const app = express();

// Browser-only concern (adds response headers, no effect on the load generator
// or any required response shape) — needed so the dashboard, served from its
// own dev-server origin, can call this API.
app.use(cors());

app.use(express.json({
    limit: "10mb"
}));

app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
});

app.use(logsRouter);

app.use(errorHandler);

export default app;
