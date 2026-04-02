/** @format */

import express from "express";
import {
    acceptInvite,
    createGroup,
    declineInvite,
    deleteGroup,
    getMyGroups,
    getPendingInvites,
    inviteMembers,
    promoteMember,
    demoteMember,
    updateGroup,
    cancelInvite,
    removeMember,
    leaveGroup,
} from "../controllers/group/groupController";
import { verifyToken } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import { createGroupSchema, groupIdParamSchema, inviteMembersSchema, memberActionSchema } from "../schemas/group.schema";

const groupRouter = express.Router();

groupRouter.get("/", verifyToken, getMyGroups);
groupRouter.get("/invites", verifyToken, getPendingInvites);
groupRouter.post("/", verifyToken, validate(createGroupSchema), createGroup);
groupRouter.patch("/:groupId/accept", verifyToken, validate(groupIdParamSchema), acceptInvite);
groupRouter.patch("/:groupId/decline", verifyToken, validate(groupIdParamSchema), declineInvite);
groupRouter.delete("/:groupId", verifyToken, validate(groupIdParamSchema), deleteGroup);
groupRouter.patch("/:groupId/members/:memberId/promote", verifyToken, validate(memberActionSchema), promoteMember);
groupRouter.delete("/:groupId/members/:memberId/promote", verifyToken, validate(memberActionSchema), demoteMember);
groupRouter.post("/:groupId/invite", verifyToken, validate(inviteMembersSchema), inviteMembers);

groupRouter.patch("/:groupId", verifyToken, validate(groupIdParamSchema), updateGroup);
groupRouter.delete("/:groupId/members/:memberId/invite", verifyToken, validate(memberActionSchema), cancelInvite);
groupRouter.delete("/:groupId/members/:memberId", verifyToken, validate(memberActionSchema), removeMember);

groupRouter.patch("/:groupId/leave", verifyToken, validate(groupIdParamSchema), leaveGroup);

export default groupRouter;
