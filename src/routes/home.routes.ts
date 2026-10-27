import { Router } from "express";

export function useHomeRoutes(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.status(200).json({ message: "Welcome to the API" });
  });

  return router;
}
