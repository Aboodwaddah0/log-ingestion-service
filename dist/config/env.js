import "dotenv/config";
const POSTGRES_HOST = process.env.POSTGRES_HOST ?? "localhost";
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT) || 5432;
const POSTGRES_USER = process.env.POSTGRES_USER ?? "postgres";
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? "postgres";
const POSTGRES_DB = process.env.POSTGRES_DB ?? "logs";
export const env = {
    PORT: Number(process.env.PORT) || 8080,
    POSTGRES_HOST,
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    DATABASE_URL: process.env.DATABASE_URL ??
        `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`,
};
