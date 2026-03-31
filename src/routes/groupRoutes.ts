/** @format */

import express from "express";
import { acceptInvite, createGroup, declineInvite, getMyGroups, getPendingInvites } from "../controllers/group/groupController.js";
import { verifyToken } from "../middlewares/auth.js";

const groupRouter = express.Router();

groupRouter.get("/", verifyToken, getMyGroups);
groupRouter.get("/invites", verifyToken, getPendingInvites);
groupRouter.post("/", verifyToken, createGroup);
groupRouter.patch("/:groupId/accept", verifyToken, acceptInvite);
groupRouter.patch("/:groupId/decline", verifyToken, declineInvite);

export default groupRouter;
