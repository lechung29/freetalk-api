/** @format */

import type { Response, RequestHandler } from "express";
import mongoose from "mongoose";
import Conversations from "../../models/conversations/conversationModel.js";
import Messages, { MessageType } from "../../models/messages/messageModel.js";
import FriendRequests, { FriendRequestStatus } from "../../models/friendRequests/friendRequestModel.js";
import Users, { IResponseStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";
import { decryptMessageDocument } from "../../utils/messageCrypto.js";
import { getIO } from "../../socket/socketInstance.js";
import { convertTimestampsInArray, convertTimestampsInObject } from "../../utils/timezoneConverter.js";
import type { GetOrCreateConversationBody, GetMessagesQuery } from "../../schemas/conversation.schema.js";

const messagePopulate = [
    { path: "sender", select: "-password -refreshToken" },
    {
        path: "replyTo",
        populate: { path: "sender", select: "-password -refreshToken" },
    },
];

async function areFriends(userAId: string, userBId: string): Promise<boolean> {
    const request = await FriendRequests.findOne({
        status: FriendRequestStatus.Accepted,
        $or: [
            { sender: userAId, receiver: userBId },
            { sender: userBId, receiver: userAId },
        ],
    });
    return !!request;
}

const getOrCreateConversation: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { targetId } = req.body as GetOrCreateConversationBody;

    if (userId === targetId) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Cannot create conversation with yourself",
        });
    }

    try {
        const friends = await areFriends(userId!, targetId);
        if (!friends) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You can only chat with your friends",
            });
        }

        let conversation = await Conversations.findOne({
            participants: { $all: [userId, targetId], $size: 2 },
        })
            .populate("participants", "-password -refreshToken")
            .populate({
                path: "lastMessage",
                populate: { path: "sender", select: "-password -refreshToken" },
            });

        if (conversation) {
            return res.status(200).send({
                status: IResponseStatus.Success,
                message: "Conversation retrieved",
                data: conversation,
            });
        }

        conversation = await Conversations.create({ participants: [userId, targetId] });
        await conversation.populate("participants", "-password -refreshToken");

        return res.status(201).send({
            status: IResponseStatus.Success,
            message: "Conversation created",
            data: conversation,
        });
    } catch (error) {
        console.error("Get or create conversation error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const getConversations: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const timezone = req.user?.timezone ?? "";

    try {
        const conversations = await Conversations.find({ participants: userId })
            .populate("participants", "-password -refreshToken")
            .populate({
                path: "lastMessage",
                populate: { path: "sender", select: "-password -refreshToken" },
            })
            .sort({ lastMessageAt: -1, createdAt: -1 })
            .lean();

        const withTimezone = conversations.map((conv: any) => {
            const converted = convertTimestampsInObject(conv, timezone, ["createdAt", "updatedAt", "lastMessageAt"]);
            if (converted.lastMessage && typeof converted.lastMessage === "object") {
                converted.lastMessage = convertTimestampsInObject(decryptMessageDocument(converted.lastMessage), timezone, ["createdAt", "editedAt"]);
            }
            // Convert nicknames Map → plain object
            if (conv.nicknames instanceof Map) {
                converted.nicknames = Object.fromEntries(conv.nicknames);
            }
            return converted;
        });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Conversations retrieved successfully",
            data: withTimezone,
        });
    } catch (error) {
        console.error("Get conversations error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const getMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const timezone = req.user?.timezone ?? "";

    if (!userId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }
    const { conversationId } = req.params;
    const { limit, before, around } = req.query as unknown as GetMessagesQuery;

    try {
        const conversation = await Conversations.findById(conversationId).lean();
        if (!conversation) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "Conversation not found",
            });
        }

        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You are not allowed to access this conversation",
            });
        }

        if (around && mongoose.Types.ObjectId.isValid(around)) {
            const anchorMsg = await Messages.findById(around).lean();
            if (!anchorMsg) {
                return res.status(404).send({ status: IResponseStatus.Error, message: "Message not found" });
            }

            const half = Math.floor(limit / 2);

            const [before_msgs, after_msgs, anchor_populated] = await Promise.all([
                Messages.find({ conversationId, createdAt: { $lt: anchorMsg.createdAt } })
                    .sort({ createdAt: -1 })
                    .limit(half)
                    .populate(messagePopulate)
                    .lean(),
                Messages.find({ conversationId, createdAt: { $gt: anchorMsg.createdAt } })
                    .sort({ createdAt: 1 })
                    .limit(half)
                    .populate(messagePopulate)
                    .lean(),
                Messages.findById(around).populate(messagePopulate).lean(),
            ]);

            if (!anchor_populated) {
                return res.status(404).send({ status: IResponseStatus.Error, message: "Message not found" });
            }

            const combined = [...before_msgs.reverse(), anchor_populated, ...after_msgs];
            const decrypted = combined.map((m) => decryptMessageDocument(m));
            const withTimezone = convertTimestampsInArray(decrypted, timezone, ["createdAt", "editedAt", "deletedAt"]);

            const oldest = before_msgs.length > 0 ? before_msgs[before_msgs.length - 1] : anchorMsg;
            const hasMore = (await Messages.exists({ conversationId, createdAt: { $lt: oldest?.createdAt } })) !== null;
            const oldestId = withTimezone.length > 0 ? String(withTimezone[0]?._id) : null;

            return res.status(200).send({
                status: IResponseStatus.Success,
                message: "Messages retrieved successfully",
                data: withTimezone,
                meta: { hasMore, oldest: oldestId, anchorId: around },
            });
        }

        const filter: Record<string, unknown> = { conversationId };
        if (before && mongoose.Types.ObjectId.isValid(before)) {
            const refMsg = await Messages.findById(before).lean();
            if (refMsg) {
                filter.createdAt = { $lt: refMsg.createdAt };
            }
        }

        const messages = await Messages.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .populate(messagePopulate)
            .lean();

        const hasMore = messages.length > limit;
        const sliced = hasMore ? messages.slice(0, limit) : messages;
        sliced.reverse();

        const decryptedMessages = sliced.map((m) => decryptMessageDocument(m));
        const withTimezone = convertTimestampsInArray(decryptedMessages, timezone, ["createdAt", "editedAt", "deletedAt"]);

        const oldest = withTimezone.length > 0 ? String(withTimezone[0]?._id) : null;

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Messages retrieved successfully",
            data: withTimezone,
            meta: { hasMore, oldest },
        });
    } catch (error) {
        console.error("Get messages error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const markAsRead: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }

    const { conversationId } = req.params;

    try {
        const conversation = await Conversations.findById(conversationId);
        if (!conversation) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "Conversation not found",
            });
        }

        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You are not allowed to update this conversation",
            });
        }

        const result = await Messages.updateMany({ conversationId, sender: { $ne: userId }, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });

        // Nếu có tin nào được đánh dấu đã đọc → emit cho sender biết
        if (result.modifiedCount > 0) {
            const io = getIO();
            if (io) {
                // Lấy conversation để biết participants
                const conv = await Conversations.findById(conversationId).select("participants").lean();
                if (conv) {
                    const otherParticipants = conv.participants.map((p: any) => p.toString()).filter((id: string) => id !== userId);
                    // Emit tới những người gửi tin (đối phương) để update isRead status
                    for (const participantId of otherParticipants) {
                        io.to(`user:${participantId}`).emit("message:read", { conversationId, readBy: userId });
                    }
                }
            }
        }

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Conversation marked as read",
        });
    } catch (error) {
        console.error("Mark conversation as read error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const getPinnedMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const timezone = req.user?.timezone ?? "";

    if (!userId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }

    const { conversationId } = req.params;

    try {
        const conversation = await Conversations.findById(conversationId).lean();
        if (!conversation) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Conversation not found" });
        }

        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "Forbidden" });
        }

        const pinned = await Messages.find({
            conversationId,
            isPinned: true,
            isDeleted: { $ne: true },
        })
            .sort({ createdAt: -1 })
            .limit(3)
            .populate(messagePopulate)
            .lean();

        const decrypted = pinned.map((m) => decryptMessageDocument(m));
        const withTimezone = convertTimestampsInArray(decrypted, timezone, ["createdAt", "editedAt", "deletedAt"]);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Pinned messages retrieved",
            data: withTimezone,
        });
    } catch (error) {
        console.error("Get pinned messages error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const searchMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const timezone = req.user?.timezone ?? "";

    if (!userId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }

    const { conversationId } = req.params;
    const keyword = req.query.keyword as string;

    try {
        const conversation = await Conversations.findById(conversationId).lean();
        if (!conversation) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "Conversation not found",
            });
        }

        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You are not allowed to access this conversation",
            });
        }
        const allMessages = await Messages.find({
            conversationId,
            type: MessageType.Text,
            isDeleted: { $ne: true },
        })
            .sort({ createdAt: -1 })
            .populate(messagePopulate)
            .lean();

        const decryptedMessages = allMessages.map((m) => decryptMessageDocument(m));
        const searchResults = decryptedMessages.filter((m) => m.content.toLowerCase().includes(keyword.toLowerCase()));

        const withTimezone = convertTimestampsInArray(searchResults, timezone, ["createdAt", "editedAt", "deletedAt"]);

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Messages searched successfully",
            data: withTimezone,
            meta: { total: withTimezone.length },
        });
    } catch (error) {
        console.error("Search messages error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

import Groups from "../../models/groups/groupModel.js";

// POST /api/v1/conversations/group/:groupId
// Lấy hoặc tạo conversation cho một nhóm
// Tất cả accepted member đều có quyền truy cập
const getOrCreateGroupConversation: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId!)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid group ID" });
    }

    try {
        const group = await Groups.findById(groupId).lean();
        if (!group) return res.status(404).send({ status: IResponseStatus.Error, message: "Group not found" });

        // Kiểm tra user có phải accepted member không
        const isMember = group.members.some((m: any) => m.user.toString() === userId && m.status === "accepted");
        if (!isMember) return res.status(403).send({ status: IResponseStatus.Error, message: "You are not a member of this group" });

        // Tìm conversation đã có cho nhóm này
        let conversation = await Conversations.findOne({ isGroup: true, groupId })
            .populate("participants", "-password -refreshToken")
            .populate({ path: "lastMessage", populate: { path: "sender", select: "-password -refreshToken" } });

        if (!conversation) {
            // Lấy tất cả accepted member ids
            const participantIds = group.members.filter((m: any) => m.status === "accepted").map((m: any) => m.user);

            const newConv = await Conversations.create({
                participants: participantIds,
                isGroup: true,
                groupId: group._id,
                lastMessage: null,
                lastMessageAt: null,
            });

            conversation = await newConv.populate("participants", "-password -refreshToken");
        }

        return res.status(200).send({
            status: IResponseStatus.Success,
            data: conversation,
        });
    } catch (error) {
        console.error("getOrCreateGroupConversation error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// PATCH /api/v1/conversations/:conversationId/nickname
// Đặt biệt danh cho 1 participant trong conversation
// Body: { targetUserId, nickname }  — nickname rỗng = xóa biệt danh
const updateNickname: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const { targetUserId, nickname } = req.body as { targetUserId: string; nickname: string };

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid conversation ID" });
    }
    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid targetUserId" });
    }

    try {
        const conversation = await Conversations.findById(conversationId)
            .populate("participants", "-password -refreshToken")
            .populate({ path: "lastMessage", populate: { path: "sender", select: "-password -refreshToken" } });

        if (!conversation) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Conversation not found" });
        }

        // Chỉ participant mới được đặt biệt danh
        const isParticipant = conversation.participants.some((p: any) => p._id.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "Not a participant" });
        }

        // targetUserId cũng phải là participant
        const isTargetParticipant = conversation.participants.some((p: any) => p._id.toString() === targetUserId);
        if (!isTargetParticipant) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "Target user is not a participant" });
        }

        const trimmed = (nickname ?? "").trim();
        if (trimmed) {
            conversation.nicknames.set(targetUserId, trimmed);
        } else {
            conversation.nicknames.delete(targetUserId);
        }

        await conversation.save();

        // Trả về conversation đã populate với nicknames dạng object
        const plain = conversation.toObject() as any;
        // Convert Map → plain object để FE parse được
        plain.nicknames = Object.fromEntries(conversation.nicknames);

        return res.status(200).send({ status: IResponseStatus.Success, data: plain });
    } catch (error) {
        console.error("updateNickname error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

// GET /api/v1/conversations/:conversationId/media
// Trả về tất cả messages có attachment (image hoặc file), sort mới nhất
const getMediaMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId!)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid conversation ID" });
    }

    try {
        const conversation = await Conversations.findById(conversationId).lean();
        if (!conversation) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Conversation not found" });
        }

        const isParticipant = conversation.participants.some((p: any) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "Not a participant" });
        }

        const mediaMessages = await Messages.find({
            conversationId,
            isDeleted: { $ne: true },
            type: { $in: ["image", "file"] },
        })
            .sort({ createdAt: -1 })
            .populate("sender", "-password -refreshToken")
            .lean();

        const decrypted = mediaMessages.map((m: any) => decryptMessageDocument(m));

        return res.status(200).send({ status: IResponseStatus.Success, data: decrypted });
    } catch (error) {
        console.error("getMediaMessages error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

export { getOrCreateConversation, getConversations, getMessages, markAsRead, getPinnedMessages, searchMessages, getOrCreateGroupConversation, updateNickname, getMediaMessages };
