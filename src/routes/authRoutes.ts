/** @format */

import express from "express";
import { loginWithGoogleSchema } from "../schemas/auth.schema";
import { validate } from "../middlewares/validate";
import { loginWithGoogle, logoutUser, refreshToken, verifyAccessToken } from "../controllers/auth/authController";
import { verifyToken } from "../middlewares/auth";

const authRouter = express.Router();

authRouter.post("/login/google", validate(loginWithGoogleSchema), loginWithGoogle);
authRouter.post("/logout", logoutUser);
authRouter.get("/refresh-token", refreshToken);
authRouter.get("/verify-token", verifyToken, verifyAccessToken);

export default authRouter;
