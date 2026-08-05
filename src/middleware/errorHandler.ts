import { type NextFunction, type Request, type Response } from "express";
import { AppError } from "../errors/AppError.js";

export function errorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
) {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
    }

    console.error(err);
    res.status(500).json({ error: "internal server error" });
}
