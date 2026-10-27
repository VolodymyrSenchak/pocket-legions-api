import express, { Application } from "express";
import cors from "cors";
import { RouteDeps, useRoutes } from "./routes";
import { SessionRoutesOptions } from "./routes/session.routes";
import { getCorsOptions } from "./utils/corsUtils";
import { errorHandler } from "./middlewares/errorHandler";

export type AppOptions = SessionRoutesOptions;

export function createApp(deps: RouteDeps, options: AppOptions = {}): Application {
  const app: Application = express();

  if (process.env.VERCEL) {
    // one proxy hop, so rate limits key on the client IP
    app.set("trust proxy", 1);
  }
  app.use(cors(getCorsOptions()));
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: true, limit: "32kb" }));
  useRoutes(app, deps, options);
  app.use(errorHandler);

  return app;
}
