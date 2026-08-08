import { AppError } from "../errors/AppError.js";
export function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
    }
    console.error(err);
    res.status(500).json({ error: "internal server error" });
}
