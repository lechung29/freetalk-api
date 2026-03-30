/** @format */

import type { Response, RequestHandler } from "express";
import mongoose from "mongoose";
import Conversations from "../../models/conversations/conversationModel.js";
import Messages, { MessageType } from "../../models/messages/messageModel.js";
import FriendRequests, { FriendRequestStatus } from "../../models/friendRequests/friendRequestModel.js";
import { IResponseStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";
import { decryptMessageDocument } from "../../utils/messageCrypto.js";
import { convertTimestampsInArray, convertTimestampsInObject } from "../../utils/timezoneConverter.js";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const messagePopulate = [
    { path: "sender", select: "-password -refreshToken" },
    {
        path: "replyTo",
        populate: {
            path: "sender",
            select: "-password -refreshToken",
        },
    },
];

// Kiểm tra 2 người có phải bạn bè không
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

// POST /api/v1/conversations
// Tạo hoặc lấy conversation giữa 2 người (chỉ khi là bạn bè)
const getOrCreateConversation: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { targetId } = req.body;

    if (!targetId || !objectIdRegex.test(targetId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid target user ID" });
    }

    if (userId === targetId) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Cannot create conversation with yourself" });
    }

    try {
        const friends = await areFriends(userId!, targetId);
        if (!friends) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You can only chat with your friends" });
        }

        // Tìm conversation đã có giữa 2 người
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

        // Tạo mới nếu chưa có
        conversation = await Conversations.create({
            participants: [userId, targetId],
        });

        await conversation.populate("participants", "-password -refreshToken");

        return res.status(201).send({
            status: IResponseStatus.Success,
            message: "Conversation created",
            data: conversation,
        });
    } catch (error) {
        console.error("Get or create conversation error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/conversations
// Lấy tất cả conversations của user (sorted by lastMessageAt)
const getConversations: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const timezone = req.user?.timezone;

    try {
        const conversations = await Conversations.find({
            participants: userId,
        })
            .populate("participants", "-password -refreshToken")
            .populate({
                path: "lastMessage",
                populate: { path: "sender", select: "-password -refreshToken" },
            })
            .sort({ lastMessageAt: -1, createdAt: -1 })
            .lean();

        const withTimezone = conversations.map((conv) => {
            const converted = convertTimestampsInObject(conv, timezone || "", ["createdAt", "updatedAt", "lastMessageAt"]);

            // Convert lastMessage timestamps if exists
            if (converted.lastMessage && typeof converted.lastMessage === "object") {
                converted.lastMessage = convertTimestampsInObject(converted.lastMessage, timezone || "", [
                    "createdAt",
                    "editedAt",
                ]);
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
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/conversations/:conversationId/messages
// Lấy messages của 1 conversation (có phân trang)
const getMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.user?.id;
    const timezone = req.user?.timezone;

    if (!userId) {
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Unauthorized",
        });
    }

    if (!conversationId) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Conversation ID is required",
        });
    }

    try {
        const conversation = await Conversations.findById(conversationId).lean();

        if (!conversation) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "Conversation not found",
            });
        }

        const isParticipant = conversation.participants.some((participant) => participant.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You are not allowed to access this conversation",
            });
        }

        const limit = Math.min(Number(req.query.limit) || 20, 50);
        const before = req.query.before as string | undefined;
        const around = req.query.around as string | undefined;

        // ── Mode: around — lấy messages xung quanh 1 message cụ thể ──
        if (around && mongoose.Types.ObjectId.isValid(around)) {
            const anchorMsg = await Messages.findById(around).lean();
            if (!anchorMsg) {
                return res.status(404).send({ status: IResponseStatus.Error, message: "Message not found" });
            }

            const half = Math.floor(limit / 2);

            // Lấy N messages trước anchor (cũ hơn)
            const before_msgs = await Messages.find({ conversationId, createdAt: { $lt: anchorMsg.createdAt } })
                .sort({ createdAt: -1 })
                .limit(half)
                .populate(messagePopulate)
                .lean();

            // Lấy N messages sau anchor (mới hơn) — không tính anchor
            const after_msgs = await Messages.find({ conversationId, createdAt: { $gt: anchorMsg.createdAt } })
                .sort({ createdAt: 1 })
                .limit(half)
                .populate(messagePopulate)
                .lean();

            // Lấy anchor message với populate đầy đủ
            const anchor_populated = await Messages.findById(around).populate(messagePopulate).lean();
            if (!anchor_populated) {
                return res.status(404).send({ status: IResponseStatus.Error, message: "Message not found" });
            }

            // Ghép lại theo thứ tự thời gian
            const combined = [...before_msgs.reverse(), anchor_populated, ...after_msgs];
            const decrypted = combined.map((m) => decryptMessageDocument(m));
            const withTimezone = convertTimestampsInArray(decrypted, timezone || "", [
                "createdAt",
                "editedAt",
                "deletedAt",
            ]);

            // hasMore: kiểm tra còn tin cũ hơn before_msgs không
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

        // ── Mode: normal pagination (before cursor) ──
        const filter: any = { conversationId };
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

        const decryptedMessages = sliced.map((message) => decryptMessageDocument(message));
        const withTimezone = convertTimestampsInArray(decryptedMessages, timezone || "", [
            "createdAt",
            "editedAt",
            "deletedAt",
        ]);

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

// PATCH /api/v1/conversations/:conversationId/read
// Đánh dấu đã đọc tất cả messages trong conversation
const markAsRead: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Unauthorized",
        });
    }

    if (!conversationId) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Conversation ID is required",
        });
    }

    try {
        const conversation = await Conversations.findById(conversationId);
        if (!conversation) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "Conversation not found",
            });
        }

        const isParticipant = conversation.participants.some((participant) => participant.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You are not allowed to update this conversation",
            });
        }

        await Messages.updateMany(
            {
                conversationId,
                sender: { $ne: userId },
                readBy: { $ne: userId },
            },
            {
                $addToSet: {
                    readBy: userId,
                },
            },
        );

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

// GET /api/v1/conversations/:conversationId/pinned
// Lấy tất cả messages đã ghim trong conversation
const getPinnedMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const { conversationId } = req.params;
    const userId = req.user?.id;
    const timezone = req.user?.timezone;

    if (!userId) return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    if (!conversationId) return res.status(400).send({ status: IResponseStatus.Error, message: "Conversation ID is required" });

    try {
        const conversation = await Conversations.findById(conversationId).lean();
        if (!conversation) return res.status(404).send({ status: IResponseStatus.Error, message: "Conversation not found" });

        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) return res.status(403).send({ status: IResponseStatus.Error, message: "Forbidden" });

        const pinned = await Messages.find({ conversationId, isPinned: true, isDeleted: { $ne: true } })
            .sort({ createdAt: -1 })
            .limit(3)
            .populate(messagePopulate)
            .lean();

        const decrypted = pinned.map((m) => decryptMessageDocument(m));
        const withTimezone = convertTimestampsInArray(decrypted, timezone || "", [
            "createdAt",
            "editedAt",
            "deletedAt",
        ]);

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

// GET /api/v1/conversations/:conversationId/search
// Tìm kiếm messages trong conversation theo keyword
const searchMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const { conversationId } = req.params;
    const { keyword } = req.query;
    const userId = req.user?.id;
    const timezone = req.user?.timezone;

    if (!userId) {
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Unauthorized",
        });
    }

    if (!conversationId) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Conversation ID is required",
        });
    }

    if (!keyword || typeof keyword !== "string" || keyword.trim() === "") {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Keyword is required for search",
        });
    }

    try {
        const conversation = await Conversations.findById(conversationId).lean();
        if (!conversation) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "Conversation not found",
            });
        }

        const isParticipant = conversation.participants.some((participant) => participant.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "You are not allowed to access this conversation",
            });
        }

        // Tìm messages text - phải decrypt trước khi search vì messages đã được mã hóa
        const allMessages = await Messages.find({
            conversationId,
            type: MessageType.Text,
            isDeleted: { $ne: true },
        })
            .sort({ createdAt: -1 })
            .populate(messagePopulate)
            .lean();

        // Decrypt và filter theo keyword
        const decryptedMessages = allMessages.map((m) => decryptMessageDocument(m));
        const searchResults = decryptedMessages.filter((m) =>
            m.content.toLowerCase().includes(keyword.toLowerCase()),
        );

        const withTimezone = convertTimestampsInArray(searchResults, timezone || "", [
            "createdAt",
            "editedAt",
            "deletedAt",
        ]);

        const total = withTimezone.length;

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Messages searched successfully",
            data: withTimezone,
            meta: {
                total,
            },
        });
    } catch (error) {
        console.error("Search messages error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

export { getOrCreateConversation, getConversations, getMessages, markAsRead, getPinnedMessages, searchMessages };
