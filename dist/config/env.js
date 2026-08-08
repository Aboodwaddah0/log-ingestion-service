import "dotenv/config";
export const env = {
    PORT: Number(process.env.PORT) || 8080,
    POSTGRES_HOST: process.env.POSTGRES_HOST ?? "localhost",
    POSTGRES_PORT: Number(process.env.POSTGRES_PORT) || 5432,
    POSTGRES_USER: process.env.POSTGRES_USER ?? "postgres",
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "postgres",
    POSTGRES_DB: process.env.POSTGRES_DB ?? "logs",
};
