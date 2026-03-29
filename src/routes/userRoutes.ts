/** @format */

import express from "express";
import { deleteUser, getUserById, searchUsers, updateUser } from "../controllers/user/userController.js";
import { verifyToken } from "../middlewares/auth.js";

const userRouter = express.Router();

userRouter.get("/search", verifyToken, searchUsers);
userRouter.get("/:id", getUserById);
userRouter.patch("/:id", verifyToken, updateUser);
userRouter.delete("/:id", verifyToken, deleteUser);

export default userRouter;
