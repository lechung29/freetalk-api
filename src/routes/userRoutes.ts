/** @format */

import express from "express";
import { deleteUser, getUserById, searchUsers, updateUser } from "../controllers/user/userController";
import { blockUser, unblockUser, getBlockStatus } from "../controllers/block/blockController";
import { verifyToken } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { getUserByIdSchema, searchUsersSchema, updateUserSchema } from "../schemas/user.schema";
import { blockTargetParamSchema } from "../schemas/block.schema";

const userRouter = express.Router();

// Block routes
userRouter.post("/block/:targetId", verifyToken, validate(blockTargetParamSchema), blockUser);
userRouter.delete("/block/:targetId", verifyToken, validate(blockTargetParamSchema), unblockUser);
userRouter.get("/block/status/:targetId", verifyToken, validate(blockTargetParamSchema), getBlockStatus);

// User routes
userRouter.get("/search", verifyToken, validate(searchUsersSchema), searchUsers);
userRouter.get("/:id", validate(getUserByIdSchema), getUserById);
userRouter.patch("/:id", verifyToken, validate(updateUserSchema), updateUser);
userRouter.delete("/:id", verifyToken, deleteUser);

export default userRouter;
