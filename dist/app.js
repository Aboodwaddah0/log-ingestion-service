import express from "express";
const app = express();
app.use(express.json());
let ready = false;
export function setReady() {
    ready = true;
}
app.get("/health", (req, res) => {
    if (!ready) {
        res.status(503).json({ status: "starting" });
        return;
    }
    res.status(200).json({ status: "ok" });
});
export default app;
