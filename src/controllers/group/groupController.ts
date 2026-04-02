/** @format */

import type { Response, RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";
import { IResponseStatus } from "../../models/users/usersModel.js";
import Users from "../../models/users/usersModel.js";
import Groups from "../../models/groups/groupModel.js";
import { saveAndEmitNotification } from "../../utils/notification.js";
import { emitToUser, getIO } from "../../socket/socketInstance.js";
import Conversations from "../../models/conversations/conversationModel.js";
import Messages from "../../models/messages/messageModel.js";
import mongoose from "mongoose";
import type { CreateGroupBody, InviteMembersBody } from "../../schemas/group.schema.js";

// ── Helper: tạo system message và broadcast tới tất cả thành viên trong room ──
async function broadcastGroupSystemMessage(groupId: string, text: string) {
    try {
        const io = getIO();
        if (!io) return;

        // Tìm group conversation
        const conversation = await Conversations.findOne({ isGroup: true, groupId }).populate("participants", "-password -refreshToken").lean();

        if (!conversation) return;

        // Tạo message type "system"
        const message = await Messages.create({
            conversationId: conversation._id,
            sender: null, // system message — không có sender
            type: "system",
            content: text,
            readBy: [],
        });

        await message.populate({ path: "sender", select: "-password -refreshToken" });

        // Cập nhật lastMessage của conversation
        await Conversations.findByIdAndUpdate(conversation._id, {
            lastMessage: message._id,
            lastMessageAt: message.createdAt,
        });

        // Broadcast tới room conversation
        io.to(`conversation:${conversation._id}`).emit("message:new", message.toObject());
    } catch (err) {
        console.error("broadcastGroupSystemMessage error:", err);
    }
}

function uniq(list: string[]) {
    return [...new Set(list.filter(Boolean))];
}

function groupToInviteDto(group: any, userId: string) {
    const pending = group.members.find((m: any) => m.user?._id?.toString?.() === userId && m.status === "pending");
    const inviter = pending?.invitedBy ?? group.owner;

    return {
        groupId: group._id.toString(),
        groupName: group.name,
        groupAvatar: group.avatar ?? null,
        description: group.description ?? null,
        inviter,
        invitedAt: pending?.invitedAt ?? group.createdAt,
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

const createGroup: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }
    const { name, description = "", avatar = null, invitedUserIds = [] } = req.body as CreateGroupBody;

    const normalizedInvites = uniq(invitedUserIds).filter((id) => id !== userId);

    if (normalizedInvites.length + 1 > 50) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Each group can have at most 50 members",
        });
    }

    try {
        const users = await Users.find({ _id: { $in: normalizedInvites } })
            .select("username email avatar timezone")
            .lean();
        const validInviteIds = users.map((u) => u._id.toString());

        const group = await Groups.create({
            name,
            description,
            avatar,
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
            validInviteIds.map((inviteId) =>
                saveAndEmitNotification({
                    recipientId: inviteId,
                    type: "group_invite",
                    title: "Group invite",
                    body: `${creatorName} invited you to join ${group.name}`,
                    data: {
                        groupId: group._id.toString(),
                        groupName: group.name,
                        groupAvatar: group.avatar ?? null,
                        inviterId: userId,
                        inviterName: creatorName,
                        memberCount: validInviteIds.length + 1,
                    },
                }),
            ),
        );

        // Tạo group conversation ngay khi tạo nhóm (chỉ với owner là participant ban đầu)
        // Các member khác ở trạng thái pending nên chưa join conversation
        await Conversations.create({
            participants: [userId],
            isGroup: true,
            groupId: group._id,
            lastMessage: null,
            lastMessageAt: null,
        });

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

const acceptInvite: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        const member = group.members.find((m) => m.user.toString() === userId);
        if (!member || member.status !== "pending") {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You do not have a pending invite for this group",
            });
        }

        const acceptedCount = group.members.filter((m) => m.status === "accepted").length;
        if (acceptedCount >= 50) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "Group is full" });
        }

        member.status = "accepted";
        member.respondedAt = new Date();
        await group.save();
        await populateGroup(group);

        // Thêm user vào participants của group conversation
        await Conversations.findOneAndUpdate({ isGroup: true, groupId: group._id }, { $addToSet: { participants: userId } });

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

const declineInvite: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        const member = group.members.find((m) => m.user.toString() === userId);
        if (!member || member.status !== "pending") {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You do not have a pending invite for this group",
            });
        }

        member.status = "declined";
        member.respondedAt = new Date();
        await group.save();

        return res.status(200).send({ status: IResponseStatus.Success, message: "Invite declined" });
    } catch (error) {
        console.error("declineInvite error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const inviteMembers: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;
    const { userIds = [] } = req.body as InviteMembersBody;

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        const requester = group.members.find((m) => m.user.toString() === userId && m.status === "accepted");
        if (!requester || (requester.role !== "owner" && requester.role !== "admin")) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "Only owner or admin can invite members",
            });
        }

        const validIds = uniq(userIds).filter((id) => id !== userId);
        const existingIds = group.members.map((m) => m.user.toString());
        const newIds = validIds.filter((id) => !existingIds.includes(id));

        const acceptedCount = group.members.filter((m) => m.status === "accepted").length;
        if (acceptedCount + newIds.length > 50) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Group would exceed 50 members",
            });
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
                    groupAvatar: group.avatar ?? null,
                    inviterId: userId,
                    inviterName,
                    memberCount: acceptedCount,
                },
            });
        }

        await group.save();
        await populateGroup(group);

        // System message
        if (newIds.length > 0) {
            const invitedUsers = await Users.find({ _id: { $in: newIds } })
                .select("username")
                .lean();
            const names = (invitedUsers as any[]).map((u) => u.username).join(", ");
            await broadcastGroupSystemMessage(groupId!, `${inviterName} đã thêm ${names} vào nhóm`);
        }

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

const deleteGroup: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    try {
        const group = await Groups.findById(groupId);
        if (!group) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        }

        if (group.owner.toString() !== userId) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "Only the owner can delete this group",
            });
        }

        await Groups.findByIdAndDelete(groupId);

        return res.status(200).send({ status: IResponseStatus.Success, message: "Group deleted successfully" });
    } catch (error) {
        console.error("deleteGroup error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// PATCH /api/v1/groups/:groupId/members/:memberId/promote  — promote member → admin
// DELETE /api/v1/groups/:groupId/members/:memberId/promote — demote admin → member
const MAX_ADMINS = 5;

const promoteMember: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId, memberId } = req.params;

    try {
        const group = await Groups.findById(groupId);
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        if (group.owner.toString() !== userId) return res.status(403).send({ status: IResponseStatus.Error, message: "Only the owner can promote members" });

        const member = group.members.find((m) => m.user.toString() === memberId && m.status === "accepted");
        if (!member) return res.status(404).send({ status: IResponseStatus.Error, message: "Member not found in group" });
        if (member.role !== "member") return res.status(400).send({ status: IResponseStatus.Error, message: "Only regular members can be promoted" });

        // Max admin check
        const currentAdmins = group.members.filter((m) => m.status === "accepted" && m.role === "admin").length;
        if (currentAdmins >= MAX_ADMINS) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: `Nhóm đã đạt tối đa ${MAX_ADMINS} admin. Hãy demote bớt trước khi promote thêm.`,
            });
        }

        member.role = "admin";
        await group.save();
        await populateGroup(group);

        const targetUser = await Users.findById(memberId).select("username").lean();
        const targetName = (targetUser as any)?.username ?? "Thành viên";
        const promoterUser = await Users.findById(userId).select("username").lean();
        const promoterName = (promoterUser as any)?.username ?? "Owner";
        await broadcastGroupSystemMessage(groupId!, `${promoterName} đã thăng ${targetName} lên admin`);

        return res.status(200).send({ status: IResponseStatus.Success, message: "Promoted to admin", data: group.toObject() });
    } catch (error) {
        console.error("promoteMember error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const demoteMember: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId, memberId } = req.params;

    try {
        const group = await Groups.findById(groupId);
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });
        if (group.owner.toString() !== userId) return res.status(403).send({ status: IResponseStatus.Error, message: "Only the owner can demote admins" });

        const member = group.members.find((m) => m.user.toString() === memberId && m.status === "accepted");
        if (!member) return res.status(404).send({ status: IResponseStatus.Error, message: "Member not found in group" });
        if (member.role !== "admin") return res.status(400).send({ status: IResponseStatus.Error, message: "Only admins can be demoted" });

        member.role = "member";
        await group.save();
        await populateGroup(group);

        const targetUser = await Users.findById(memberId).select("username").lean();
        const targetName = (targetUser as any)?.username ?? "Admin";
        const demoterUser = await Users.findById(userId).select("username").lean();
        const demoterName = (demoterUser as any)?.username ?? "Owner";
        await broadcastGroupSystemMessage(groupId!, `${demoterName} đã hạ ${targetName} xuống thành viên`);

        return res.status(200).send({ status: IResponseStatus.Success, message: "Demoted to member", data: group.toObject() });
    } catch (error) {
        console.error("demoteMember error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// PATCH /api/v1/groups/:groupId
// Chỉ owner được cập nhật thông tin nhóm (tên, mô tả, avatar)
const updateGroup: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;
    const { name, description, avatar } = req.body as {
        name?: string;
        description?: string;
        avatar?: string | null;
    };

    try {
        const group = await Groups.findById(groupId);
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });

        if (group.owner.toString() !== userId) return res.status(403).send({ status: IResponseStatus.Error, message: "Only the owner can update group info" });

        const oldName = group.name;
        if (name !== undefined) {
            if (!name.trim()) return res.status(400).send({ status: IResponseStatus.Error, message: "Group name cannot be empty" });
            group.name = name.trim();
        }
        if (description !== undefined) group.description = description.trim();
        if (avatar !== undefined) group.avatar = avatar;

        await group.save();
        await populateGroup(group);

        // System messages
        const updater = await Users.findById(userId).select("username").lean();
        const updaterName = (updater as any)?.username ?? "Ai đó";
        if (name !== undefined && name.trim() !== oldName) {
            await broadcastGroupSystemMessage(groupId!, `${updaterName} đã đổi tên nhóm thành "${group.name}"`);
        } else if (description !== undefined) {
            await broadcastGroupSystemMessage(groupId!, `${updaterName} đã cập nhật mô tả nhóm`);
        } else if (avatar !== undefined) {
            await broadcastGroupSystemMessage(groupId!, `${updaterName} đã cập nhật ảnh nhóm`);
        }

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Group updated successfully",
            data: group.toObject(),
        });
    } catch (error) {
        console.error("updateGroup error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// DELETE /api/v1/groups/:groupId/members/:memberId/invite
const cancelInvite: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId, memberId } = req.params;
    try {
        const group = await Groups.findById(groupId);
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });

        const requester = group.members.find((m) => m.user.toString() === userId && m.status === "accepted");
        if (!requester || (requester.role !== "owner" && requester.role !== "admin")) return res.status(403).send({ status: IResponseStatus.Error, message: "Only owner or admin can cancel invites" });

        const target = group.members.find((m) => m.user.toString() === memberId && m.status === "pending");
        if (!target) return res.status(404).send({ status: IResponseStatus.Error, message: "Pending invite not found" });

        group.members = group.members.filter((m) => !(m.user.toString() === memberId && m.status === "pending")) as typeof group.members;
        await group.save();
        await populateGroup(group);

        // Silent — trigger reload ở B, không toast
        emitToUser(memberId!, "group:invite_cancelled", { groupId: group._id.toString(), groupName: group.name });

        return res.status(200).send({ status: IResponseStatus.Success, message: "Invite cancelled", data: group.toObject() });
    } catch (error) {
        console.error("cancelInvite error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// DELETE /api/v1/groups/:groupId/members/:memberId
const removeMember: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId, memberId } = req.params;
    try {
        const group = await Groups.findById(groupId);
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });

        const requester = group.members.find((m) => m.user.toString() === userId && m.status === "accepted");
        if (!requester || (requester.role !== "owner" && requester.role !== "admin")) return res.status(403).send({ status: IResponseStatus.Error, message: "Only owner or admin can remove members" });

        const target = group.members.find((m) => m.user.toString() === memberId && m.status === "accepted");
        if (!target) return res.status(404).send({ status: IResponseStatus.Error, message: "Member not found" });
        if (target.role === "owner") return res.status(400).send({ status: IResponseStatus.Error, message: "Cannot remove the group owner" });
        if (requester.role === "admin" && target.role === "admin") return res.status(403).send({ status: IResponseStatus.Error, message: "Admins cannot remove other admins" });

        group.members = group.members.filter((m) => !(m.user.toString() === memberId && m.status === "accepted")) as typeof group.members;
        await group.save();
        await populateGroup(group);

        const remover = await Users.findById(userId).select("username").lean();
        const removerName = (remover as any)?.username ?? "Admin";
        const updatedGroupObj = group.toObject();

        // Gửi notification (lưu DB + toast) cho B
        await saveAndEmitNotification({
            recipientId: memberId!,
            type: "group_member_removed",
            title: "Bị xóa khỏi nhóm",
            body: `${removerName} đã xóa bạn khỏi nhóm "${group.name}"`,
            data: { groupId: group._id.toString(), groupName: group.name, removedBy: removerName },
        });

        // Socket cho A (người xóa) để update UI — không lưu DB, không toast
        emitToUser(userId!, "group:member_removed", { groupId: group._id.toString(), updatedGroup: updatedGroupObj });

        // System message
        const removedUser = await Users.findById(memberId).select("username").lean();
        const removedName = (removedUser as any)?.username ?? "Thành viên";
        await broadcastGroupSystemMessage(groupId!, `${removerName} đã xóa ${removedName} khỏi nhóm`);

        return res.status(200).send({ status: IResponseStatus.Success, message: "Member removed", data: updatedGroupObj });
    } catch (error) {
        console.error("removeMember error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

export { createGroup, getMyGroups, getPendingInvites, acceptInvite, declineInvite, deleteGroup, promoteMember, demoteMember, inviteMembers, updateGroup, cancelInvite, removeMember, leaveGroup };

// PATCH /api/v1/groups/:groupId/leave
// Member/Admin rời nhóm bình thường
// Owner rời nhóm phải gửi kèm newOwnerId (id admin cụ thể hoặc "random")
const leaveGroup: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;
    const { newOwnerId } = req.body as { newOwnerId?: string };

    try {
        const group = await Groups.findById(groupId);
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });

        const member = group.members.find((m) => m.user.toString() === userId && m.status === "accepted");
        if (!member) return res.status(403).send({ status: IResponseStatus.Error, message: "You are not a member of this group" });

        const isOwner = group.owner.toString() === userId;

        if (isOwner) {
            // Owner rời → phải chuyển quyền
            const admins = group.members.filter((m) => m.status === "accepted" && m.role === "admin" && m.user.toString() !== userId);

            if (admins.length === 0) {
                return res.status(400).send({ status: IResponseStatus.Error, message: "Không có admin nào để chuyển quyền. Hãy promote thành viên lên admin trước." });
            }

            let nextOwnerMember: (typeof admins)[number] | undefined;

            if (newOwnerId === "random") {
                nextOwnerMember = admins[Math.floor(Math.random() * admins.length)];
            } else if (newOwnerId) {
                nextOwnerMember = admins.find((m) => m.user.toString() === newOwnerId);
                if (!nextOwnerMember) {
                    return res.status(400).send({ status: IResponseStatus.Error, message: "Admin được chọn không hợp lệ" });
                }
            } else {
                return res.status(400).send({ status: IResponseStatus.Error, message: "Owner phải chỉ định người kế nhiệm" });
            }

            const nextOwnerId = nextOwnerMember?.user.toString();

            // Đổi role nextOwner → owner
            nextOwnerMember!.role = "owner";
            group.owner = nextOwnerMember?.user as any;

            // Xóa owner cũ khỏi members
            group.members = group.members.filter((m) => m.user.toString() !== userId) as typeof group.members;

            await group.save();
            await populateGroup(group);

            // Xóa owner khỏi participants của group conversation
            await Conversations.findOneAndUpdate({ isGroup: true, groupId: group._id }, { $pull: { participants: new mongoose.Types.ObjectId(userId!) } });

            // System message — owner rời + chuyển quyền
            const ownerUser = await Users.findById(userId).select("username").lean();
            const ownerName = (ownerUser as any)?.username ?? "Owner";
            const newOwnerUser = await Users.findById(nextOwnerId).select("username").lean();
            const newOwnerName = (newOwnerUser as any)?.username ?? "Admin";
            await broadcastGroupSystemMessage(groupId!, `${ownerName} đã rời nhóm và chuyển quyền owner cho ${newOwnerName}`);

            return res.status(200).send({
                status: IResponseStatus.Success,
                message: "Đã rời nhóm và chuyển quyền owner",
                data: group.toObject(),
            });
        }

        // Member / Admin rời bình thường
        group.members = group.members.filter((m) => m.user.toString() !== userId) as typeof group.members;
        await group.save();
        await populateGroup(group);

        // Xóa khỏi participants của group conversation
        await Conversations.findOneAndUpdate({ isGroup: true, groupId: group._id }, { $pull: { participants: new mongoose.Types.ObjectId(userId!) } });

        // System message — member/admin rời
        const leaverUser = await Users.findById(userId).select("username").lean();
        const leaverName = (leaverUser as any)?.username ?? "Thành viên";
        await broadcastGroupSystemMessage(groupId!, `${leaverName} đã rời nhóm`);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Đã rời nhóm",
            data: group.toObject(),
        });
    } catch (error) {
        console.error("leaveGroup error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};
