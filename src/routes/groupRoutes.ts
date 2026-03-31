/** @format */

import express from "express";
import { acceptInvite, createGroup, declineInvite, deleteGroup, getMyGroups, getPendingInvites, inviteMembers, promoteMember } from "../controllers/group/groupController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { createGroupSchema, groupIdParamSchema, inviteMembersSchema, memberActionSchema } from "../schemas/group.schema.js";

const groupRouter = express.Router();

groupRouter.get("/", verifyToken, getMyGroups);
groupRouter.get("/invites", verifyToken, getPendingInvites);
groupRouter.post("/", verifyToken, validate(createGroupSchema), createGroup);
groupRouter.patch("/:groupId/accept", verifyToken, validate(groupIdParamSchema), acceptInvite);
groupRouter.patch("/:groupId/decline", verifyToken, validate(groupIdParamSchema), declineInvite);
groupRouter.delete("/:groupId", verifyToken, validate(groupIdParamSchema), deleteGroup);
groupRouter.patch("/:groupId/members/:memberId/promote", verifyToken, validate(memberActionSchema), promoteMember);
groupRouter.post("/:groupId/invite", verifyToken, validate(inviteMembersSchema), inviteMembers);

export default groupRouter;
