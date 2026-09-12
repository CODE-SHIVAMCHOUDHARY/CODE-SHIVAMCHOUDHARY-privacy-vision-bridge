import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const errorType = typeof err === "object" && err !== null && "type" in err
    ? String((err as { type?: unknown }).type)
    : "";

  if (errorType === "entity.too.large") {
    res.status(413).json({ success: false, error: "Image payload is too large" });
    return;
  }

  res.status(400).json({ success: false, error: "Malformed JSON request" });
});

export default app;
