/** @format */

import type { Response, RequestHandler } from "express";
import mongoose from "mongoose";
import Conversations from "../../models/conversations/conversationModel.js";
import Messages from "../../models/messages/messageModel.js";
import FriendRequests, { FriendRequestStatus } from "../../models/friendRequests/friendRequestModel.js";
import { IResponseStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

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

    try {
        const conversations = await Conversations.find({
            participants: userId,
        })
            .populate("participants", "-password -refreshToken")
            .populate({
                path: "lastMessage",
                populate: { path: "sender", select: "-password -refreshToken" },
            })
            .sort({ lastMessageAt: -1, createdAt: -1 });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Conversations retrieved successfully",
            data: conversations,
        });
    } catch (error) {
        console.error("Get conversations error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/conversations/:conversationId/messages
// Lấy messages của 1 conversation (có phân trang)
const getMessages: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const before = req.query.before as string; // cursor: lấy messages trước thời điểm này

    if (!objectIdRegex.test(conversationId || "")) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid conversation ID" });
    }

    try {
        const conversation = await Conversations.findById(conversationId);

        if (!conversation) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Conversation not found" });
        }

        // Kiểm tra user có trong conversation không
        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You are not a participant of this conversation" });
        }

        const query: any = { conversationId };
        if (before && objectIdRegex.test(before)) {
            const cursorMessage = await Messages.findById(before);
            if (cursorMessage) {
                query.createdAt = { $lt: cursorMessage.createdAt };
            }
        }

        const messages = await Messages.find(query).populate("sender", "-password -refreshToken").sort({ createdAt: -1 }).limit(limit);

        // Trả về theo thứ tự cũ → mới
        messages.reverse();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Messages retrieved successfully",
            data: messages,
            meta: {
                hasMore: messages.length === limit,
                oldest: messages[0]?._id ?? null,
            },
        });
    } catch (error) {
        console.error("Get messages error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// PATCH /api/v1/conversations/:conversationId/read
// Đánh dấu đã đọc tất cả messages trong conversation
const markAsRead: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { conversationId } = req.params;

    if (!objectIdRegex.test(conversationId || "")) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid conversation ID" });
    }

    try {
        const conversation = await Conversations.findById(conversationId);

        if (!conversation) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Conversation not found" });
        }

        const isParticipant = conversation.participants.some((p) => p.toString() === userId);
        if (!isParticipant) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You are not a participant of this conversation" });
        }

        await Messages.updateMany({ conversationId, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Messages marked as read",
        });
    } catch (error) {
        console.error("Mark as read error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

export { getOrCreateConversation, getConversations, getMessages, markAsRead };
