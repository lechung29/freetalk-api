/** @format */

import express from "express";
import {
    loginWithGoogle,
    logoutUser,
    refreshToken,
    verifyAccessToken,
} from "../controllers/auth/authController.js";
import { verifyToken } from "../middlewares/auth.js";

const authRouter = express.Router();

authRouter.post("/login/google", loginWithGoogle);
authRouter.post("/logout", logoutUser);
authRouter.get("/refresh-token", refreshToken);
authRouter.get("/verify-token", verifyToken, verifyAccessToken);

export default authRouter;
