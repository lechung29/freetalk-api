/** @format */

import express from "express";
import { loginWithGoogle, logoutUser, refreshToken, verifyAccessToken } from "../controllers/auth/authController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { loginWithGoogleSchema } from "../schemas/auth.schema.js";

const authRouter = express.Router();

authRouter.post("/login/google", validate(loginWithGoogleSchema), loginWithGoogle);
authRouter.post("/logout", logoutUser);
authRouter.get("/refresh-token", refreshToken);
authRouter.get("/verify-token", verifyToken, verifyAccessToken);

export default authRouter;
