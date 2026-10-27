import serviceFactory from "../services/serviceFactory";
import {AuthService} from "../services/auth.service";
import {NextFunction, Request, Response} from "express";
import {setReqContext} from "../utils/requestUtils";

export const validateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" }) as any;
  }

  const token = authHeader.split(" ")[1];
  const authService = serviceFactory.getService(AuthService);

  const userOperation = await authService.getUser(token);
  if (!userOperation.isSuccess) {
    return res.status(401).json({ error: "Invalid token" }) as any;
  } else {
    setReqContext(req, { user: userOperation.result });
  }

  next();
};
