/** @format */

import express from "express";
import { deleteUser, getUserById, searchUsers, updateUser } from "../controllers/user/userController.js";
import { blockUser, unblockUser, getBlockStatus } from "../controllers/block/blockController.js";
import { verifyToken } from "../middlewares/auth.js";

const userRouter = express.Router();

userRouter.post("/block/:targetId", verifyToken, blockUser);
userRouter.delete("/block/:targetId", verifyToken, unblockUser);
userRouter.get("/block/status/:targetId", verifyToken, getBlockStatus);

// User routes
userRouter.get("/search", verifyToken, searchUsers);
userRouter.get("/:id", getUserById);
userRouter.patch("/:id", verifyToken, updateUser);
userRouter.delete("/:id", verifyToken, deleteUser);

export default userRouter;
