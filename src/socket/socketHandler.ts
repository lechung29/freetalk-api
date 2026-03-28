/** @format */

import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import Messages from "../models/messages/messageModel.js";
import Conversations from "../models/conversations/conversationModel.js";
import FriendRequests, { FriendRequestStatus } from "../models/friendRequests/friendRequestModel.js";

// Map userId → Set<socketId> (1 user có thể mở nhiều tab)
const onlineUsers = new Map<string, Set<string>>();

function addOnlineUser(userId: string, socketId: string) {
    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socketId);
}

function removeOnlineUser(userId: string, socketId: string) {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
        onlineUsers.delete(userId);
    }
}

function getSocketIds(userId: string): string[] {
    return Array.from(onlineUsers.get(userId) ?? []);
}

export function isUserOnline(userId: string): boolean {
    return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
}

export function initSocket(io: SocketIOServer) {
    // ── Auth middleware ──
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token as string;
        if (!token) return next(new Error("Unauthorized"));

        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
            (socket as any).userId = payload.id as string;
            next();
        } catch {
            next(new Error("Unauthorized"));
        }
    });

    io.on("connection", (socket: Socket) => {
        const userId = (socket as any).userId as string;

        addOnlineUser(userId, socket.id);

        // Thông báo cho bạn bè biết user này online
        notifyFriendsOnlineStatus(io, userId, true);

        // ── Join room của chính mình để nhận events cá nhân ──
        socket.join(`user:${userId}`);

        // ─────────────────────────────────────────────────────
        // EVENT: Lấy danh sách online của bạn bè
        // ─────────────────────────────────────────────────────
        socket.on("friends:get_online", async () => {
            try {
                const requests = await FriendRequests.find({
                    status: FriendRequestStatus.Accepted,
                    $or: [{ sender: userId }, { receiver: userId }],
                });

                const friendIds = requests.map((r) =>
                    r.sender.toString() === userId ? r.receiver.toString() : r.sender.toString(),
                );

                const onlineStatus = friendIds.reduce<Record<string, boolean>>((acc, id) => {
                    acc[id] = isUserOnline(id);
                    return acc;
                }, {});

                socket.emit("friends:online_status", onlineStatus);
            } catch (err) {
                console.error("friends:get_online error:", err);
            }
        });

        // ─────────────────────────────────────────────────────
        // EVENT: Join conversation room
        // ─────────────────────────────────────────────────────
        socket.on("conversation:join", async (conversationId: string) => {
            try {
                const conversation = await Conversations.findById(conversationId);
                if (!conversation) return;

                const isParticipant = conversation.participants.some((p) => p.toString() === userId);
                if (!isParticipant) return;

                socket.join(`conversation:${conversationId}`);
            } catch (err) {
                console.error("conversation:join error:", err);
            }
        });

        // ─────────────────────────────────────────────────────
        // EVENT: Leave conversation room
        // ─────────────────────────────────────────────────────
        socket.on("conversation:leave", (conversationId: string) => {
            socket.leave(`conversation:${conversationId}`);
        });

        // ─────────────────────────────────────────────────────
        // EVENT: Gửi tin nhắn
        // Payload: { conversationId, content, type? }
        // ─────────────────────────────────────────────────────
        socket.on("message:send", async (payload: { conversationId: string; content: string; type?: string }) => {
            const { conversationId, content, type = "text" } = payload;

            if (!conversationId || !content?.trim()) return;

            try {
                const conversation = await Conversations.findById(conversationId);
                if (!conversation) return;

                const isParticipant = conversation.participants.some((p) => p.toString() === userId);
                if (!isParticipant) return;

                // Kiểm tra vẫn còn là bạn bè
                const otherParticipant = conversation.participants.find((p) => p.toString() !== userId);
                if (!otherParticipant) return;

                const stillFriends = await FriendRequests.findOne({
                    status: FriendRequestStatus.Accepted,
                    $or: [
                        { sender: userId, receiver: otherParticipant },
                        { sender: otherParticipant, receiver: userId },
                    ],
                });

                if (!stillFriends) {
                    socket.emit("message:error", { message: "You can only chat with your friends" });
                    return;
                }

                // Tạo message
                const message = await Messages.create({
                    conversationId,
                    sender: userId,
                    content: content.trim(),
                    type,
                    readBy: [userId],
                });

                await message.populate("sender", "-password -refreshToken");

                // Cập nhật lastMessage trên conversation
                await Conversations.findByIdAndUpdate(conversationId, {
                    lastMessage: message._id,
                    lastMessageAt: message.createdAt,
                });

                // Gửi đến tất cả người trong conversation room
                io.to(`conversation:${conversationId}`).emit("message:new", message);

                // Nếu người nhận không trong room → gửi notification vào room cá nhân
                const recipientSocketIds = getSocketIds(otherParticipant.toString());
                const isRecipientInRoom = recipientSocketIds.some((sid) => {
                    const recipientSocket = io.sockets.sockets.get(sid);
                    return recipientSocket?.rooms.has(`conversation:${conversationId}`);
                });

                if (!isRecipientInRoom) {
                    // Populate conversation để gửi kèm preview
                    const updatedConversation = await Conversations.findById(conversationId)
                        .populate("participants", "-password -refreshToken")
                        .populate({
                            path: "lastMessage",
                            populate: { path: "sender", select: "-password -refreshToken" },
                        });

                    io.to(`user:${otherParticipant}`).emit("conversation:updated", updatedConversation);
                }
            } catch (err) {
                console.error("message:send error:", err);
                socket.emit("message:error", { message: "Failed to send message" });
            }
        });

        // ─────────────────────────────────────────────────────
        // EVENT: Typing indicator
        // Payload: { conversationId, isTyping }
        // ─────────────────────────────────────────────────────
        socket.on("message:typing", (payload: { conversationId: string; isTyping: boolean }) => {
            const { conversationId, isTyping } = payload;
            if (!conversationId) return;

            socket.to(`conversation:${conversationId}`).emit("message:typing", {
                userId,
                conversationId,
                isTyping,
            });
        });

        // ─────────────────────────────────────────────────────
        // EVENT: Disconnect
        // ─────────────────────────────────────────────────────
        socket.on("disconnect", () => {
            removeOnlineUser(userId, socket.id);
            notifyFriendsOnlineStatus(io, userId, false);
        });
    });
}

// Thông báo bạn bè khi user online/offline
async function notifyFriendsOnlineStatus(io: SocketIOServer, userId: string, isOnline: boolean) {
    try {
        const requests = await FriendRequests.find({
            status: FriendRequestStatus.Accepted,
            $or: [{ sender: userId }, { receiver: userId }],
        });

        requests.forEach((r) => {
            const friendId = r.sender.toString() === userId ? r.receiver.toString() : r.sender.toString();
            io.to(`user:${friendId}`).emit("friend:online_status", {
                userId,
                isOnline,
            });
        });
    } catch (err) {
        console.error("notifyFriendsOnlineStatus error:", err);
    }
}
