/** @format */

import express from "express";
import { deleteUser, getUserById, searchUsers, updateUser } from "../controllers/user/userController.js";
import { blockUser, unblockUser, getBlockStatus } from "../controllers/block/blockController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { getUserByIdSchema, searchUsersSchema, updateUserSchema } from "../schemas/user.schema.js";
import { blockTargetParamSchema } from "../schemas/block.schema.js";

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
