import { Application } from "express";
import {useHomeRoutes} from "./home.routes";
import {useAuthRoutes} from "./auth.routes";
import {SessionRoutesOptions, useSessionRoutes} from "./session.routes";
import {SessionService} from "../services/session.service";

export interface RouteDeps {
  sessionService: SessionService;
}

export function useRoutes(app: Application, deps: RouteDeps, options: SessionRoutesOptions = {}): void {
  app.use("/api", useHomeRoutes());
  app.use("/api/auth", useAuthRoutes());
  app.use("/api/sessions", useSessionRoutes(deps.sessionService, options));
}
