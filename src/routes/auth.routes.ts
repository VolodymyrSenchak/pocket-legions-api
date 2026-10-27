import {Router} from "express";
import serviceFactory from "../services/serviceFactory";
import {AuthService} from "../services/auth.service";
import {failure} from "../models";
import {getReqContext, getUserId, setResResult} from "../utils/requestUtils";
import {validateToken} from "../middlewares/validateToken";

export const useAuthRoutes = () => {
  const router = Router();
  const authSrv = () => serviceFactory.getService(AuthService);

  router.post("/login", async (req, res) => {
    const result = await authSrv().login(req.body);
    setResResult(res, result, null, 401);
  });

  router.post("/google", async (req, res) => {
    const { idToken, nonce, accessToken } = req.body;
    if (!idToken) {
      setResResult(res, failure("idToken is required", "bad-request"));
      return;
    }

    const result = await authSrv().loginWithGoogle({ idToken, nonce, accessToken });
    setResResult(res, result, null, 401);
  });

  router.post("/refreshToken", async (req, res) => {
    const { refreshToken } = req.body;
    const result = await authSrv().refreshToken(refreshToken);
    setResResult(res, result, null, 401);
  });

  router.post( "/register", async (req, res) => {
    const result = await authSrv().register(req.body);
    setResResult(res, result);
  });

  router.get("/userDetails", validateToken, (req, res) => {
    const user = getReqContext(req).user;
    res.status(200).json(user);
  });

  router.post("/resetPassword", async (req, res) => {
    const result = await authSrv().resetPassword(req.body);
    setResResult(res, result);
  });

  router.post("/changePassword", validateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      setResResult(res, failure("currentPassword and newPassword are required", "bad-request"));
      return;
    }

    const user = getReqContext(req).user;
    const result = await authSrv().changePassword({
      userId: getUserId(req)!,
      email: user!.email!,
      currentPassword,
      newPassword,
    });
    setResResult(res, result);
  });

  router.post("/changePasswordForgotten", validateToken, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) {
      setResResult(res, failure("newPassword is required", "bad-request"));
      return;
    }

    const result = await authSrv().changePasswordForgotten({
      userId: getUserId(req)!,
      newPassword,
    });
    setResResult(res, result);
  });

  return router;
};