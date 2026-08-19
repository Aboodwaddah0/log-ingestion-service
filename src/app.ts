import cors from "cors";
import express, { type Request, type Response } from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import logsRouter from "./routes/logs.js";

const app = express();

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
