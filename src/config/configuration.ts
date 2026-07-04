export default () => ({
  port: parseInt(process.env.PORT ?? "4000", 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    name: process.env.DB_NAME ?? "idola_stekom",
    sync: (process.env.DB_SYNC ?? "false") === "true",
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? "change-me",
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  },
});
