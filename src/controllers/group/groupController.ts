/** @format */

import type { Response, RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";
import { IResponseStatus } from "../../models/users/usersModel.js";
import Users from "../../models/users/usersModel.js";
import Groups from "../../models/groups/groupModel.js";
import { saveAndEmitNotification } from "../../utils/notification.js";
import mongoose from "mongoose";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

function uniq(list: string[]) {
    return [...new Set(list.filter(Boolean))];
}

function groupToInviteDto(group: any, userId: string) {
    const pending = group.members.find((m: any) => m.user?._id?.toString?.() === userId && m.status === "pending");
    const inviter = pending?.invitedBy || group.owner;

    return {
        groupId: group._id.toString(),
        groupName: group.name,
        groupAvatar: group.avatar || null,
        description: group.description || null,
        inviter,
        invitedAt: pending?.invitedAt || group.createdAt,
        memberCount: group.members.filter((m: any) => m.status === "accepted").length,
    };
}

async function populateGroup(group: any) {
    await group.populate([
        { path: "owner", select: "-password -refreshToken" },
        { path: "members.user", select: "-password -refreshToken" },
        { path: "members.invitedBy", select: "-password -refreshToken" },
    ]);
    return group;
}

// POST /api/v1/groups
const createGroup: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const {
        name,
        description = "",
        avatar = null,
        invitedUserIds = [],
    } = req.body as {
        name?: string;
        description?: string;
        avatar?: string | null;
        invitedUserIds?: string[];
    };

    if (!userId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }

    if (!name?.trim()) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Group name is required" });
    }

    const normalizedInvites = uniq(invitedUserIds).filter((id) => objectIdRegex.test(id) && id !== userId);

    if (normalizedInvites.length + 1 > 50) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Each group can have at most 50 members" });
    }

    try {
        const users = await Users.find({ _id: { $in: normalizedInvites } })
            .select("username email avatar timezone")
            .lean();
        const validInviteIds = users.map((u) => u._id.toString());

        const group = await Groups.create({
            name: name.trim(),
            description: description?.trim(),
            avatar: avatar || null,
            owner: userId,
            members: [
                {
                    user: userId,
                    role: "owner",
                    status: "accepted",
                    invitedBy: null,
                    invitedAt: new Date(),
                    respondedAt: new Date(),
                },
                ...validInviteIds.map((inviteId) => ({
                    user: inviteId,
                    role: "member",
                    status: "pending",
                    invitedBy: userId,
                    invitedAt: new Date(),
                    respondedAt: null,
                })),
            ],
        });

        const populated = await populateGroup(group);

        const creator = await Users.findById(userId).select("username avatar").lean();
        const creatorName = (creator as any)?.username ?? "Someone";

        await Promise.all(
            validInviteIds.map(async (inviteId) => {
                await saveAndEmitNotification({
                    recipientId: inviteId,
                    type: "group_invite",
                    title: "Group invite",
                    body: `${creatorName} invited you to join ${group.name}`,
                    data: {
                        groupId: group._id.toString(),
                        groupName: group.name,
                        groupAvatar: group.avatar || null,
                        inviterId: userId,
                        inviterName: creatorName,
                        memberCount: validInviteIds.length + 1,
                    },
                });
            }),
        );

        return res.status(201).send({
            status: IResponseStatus.Success,
            message: "Group created successfully",
            data: populated,
        });
    } catch (error) {
        console.error("createGroup error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// GET /api/v1/groups
const getMyGroups: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        const groups = await Groups.find({
            members: { $elemMatch: { user: userId, status: "accepted" } },
        })
            .sort({ updatedAt: -1 })
            .lean();

        const populated = await Promise.all(
            groups.map(async (g) => {
                const doc = await Groups.findById(g._id);
                if (!doc) return null;
                await populateGroup(doc);
                return doc.toObject();
            }),
        );

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Groups retrieved successfully",
            data: populated.filter(Boolean),
        });
    } catch (error) {
        console.error("getMyGroups error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// GET /api/v1/groups/invites
const getPendingInvites: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        const groups = await Groups.find({
            members: { $elemMatch: { user: userId, status: "pending" } },
        })
            .sort({ createdAt: -1 })
            .populate([
                { path: "owner", select: "-password -refreshToken" },
                { path: "members.user", select: "-password -refreshToken" },
                { path: "members.invitedBy", select: "-password -refreshToken" },
            ])
            .lean();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Group invites retrieved successfully",
            data: groups.map((group: any) => groupToInviteDto(group, userId!)),
        });
    } catch (error) {
        console.error("getPendingInvites error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// PATCH /api/v1/groups/:groupId/accept
const acceptInvite: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    if (!groupId || !objectIdRegex.test(groupId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid group ID" });
    }

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        const member = group.members.find((m) => m.user.toString() === userId);
        if (!member || member.status !== "pending") {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You do not have a pending invite for this group" });
        }

        const acceptedCount = group.members.filter((m) => m.status === "accepted").length;
        if (acceptedCount >= 50) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "Group is full" });
        }

        member.status = "accepted";
        member.respondedAt = new Date();
        await group.save();

        await populateGroup(group);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Joined group successfully",
            data: group.toObject(),
        });
    } catch (error) {
        console.error("acceptInvite error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// PATCH /api/v1/groups/:groupId/decline
const declineInvite: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    if (!groupId || !objectIdRegex.test(groupId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid group ID" });
    }

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        const member = group.members.find((m) => m.user.toString() === userId);
        if (!member || member.status !== "pending") {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You do not have a pending invite for this group" });
        }

        member.status = "declined";
        member.respondedAt = new Date();
        await group.save();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Invite declined",
        });
    } catch (error) {
        console.error("declineInvite error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// POST /api/v1/groups/:groupId/invite — owner/admin mời thêm thành viên
const inviteMembers: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;
    const { userIds = [] } = req.body as { userIds?: string[] };

    if (!groupId || !objectIdRegex.test(groupId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid group ID" });
    }

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        const requester = group.members.find((m) => m.user.toString() === userId && m.status === "accepted");
        if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "Only owner or admin can invite members" });
        }

        const validIds = uniq(userIds).filter((id) => objectIdRegex.test(id) && id !== userId);
        const existingIds = group.members.map((m) => m.user.toString());
        const newIds = validIds.filter((id) => !existingIds.includes(id));

        const acceptedCount = group.members.filter((m) => m.status === "accepted").length;
        if (acceptedCount + newIds.length > 50) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "Group would exceed 50 members" });
        }

        const inviter = await Users.findById(userId).select("username").lean();
        const inviterName = (inviter as any)?.username ?? "Someone";

        for (const inviteId of newIds) {
            group.members.push({
                user: new mongoose.Types.ObjectId(inviteId),
                role: "member",
                status: "pending",
                invitedBy: new mongoose.Types.ObjectId(userId),
                invitedAt: new Date(),
                respondedAt: null,
            } as any);

            await saveAndEmitNotification({
                recipientId: inviteId,
                type: "group_invite",
                title: "Group invite",
                body: `${inviterName} invited you to join ${group.name}`,
                data: {
                    groupId: group._id.toString(),
                    groupName: group.name,
                    groupAvatar: group.avatar || null,
                    inviterId: userId,
                    inviterName,
                    memberCount: acceptedCount,
                },
            });
        }

        await group.save();
        await populateGroup(group);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: `Invited ${newIds.length} member(s)`,
            data: group.toObject(),
        });
    } catch (error) {
        console.error("inviteMembers error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// DELETE /api/v1/groups/:groupId  — chỉ owner mới được xóa
const deleteGroup: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    if (!groupId || !objectIdRegex.test(groupId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid group ID" });
    }

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        if (group.owner.toString() !== userId) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "Only the owner can delete this group" });
        }

        await Groups.findByIdAndDelete(groupId);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Group deleted successfully",
        });
    } catch (error) {
        console.error("deleteGroup error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// PATCH /api/v1/groups/:groupId/members/:memberId/promote  — chỉ owner promote lên admin
const promoteMember: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId, memberId } = req.params;

    if (!groupId || !objectIdRegex.test(groupId) || !memberId || !objectIdRegex.test(memberId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid ID" });
    }

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        if (group.owner.toString() !== userId) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "Only the owner can promote members" });
        }

        const member = group.members.find((m) => m.user.toString() === memberId && m.status === "accepted");
        if (!member) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Member not found in group" });
        }

        if (member.role === "owner") {
            return res.status(400).send({ status: IResponseStatus.Error, message: "Cannot change owner's role" });
        }

        member.role = member.role === "admin" ? "member" : "admin";
        await group.save();

        await populateGroup(group);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: `Member ${member.role === "admin" ? "promoted to admin" : "demoted to member"}`,
            data: group.toObject(),
        });
    } catch (error) {
        console.error("promoteMember error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

export { createGroup, getMyGroups, getPendingInvites, acceptInvite, declineInvite, deleteGroup, promoteMember, inviteMembers };
