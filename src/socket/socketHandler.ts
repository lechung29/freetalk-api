/** @format */

import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import Messages from "../models/messages/messageModel.js";
import Conversations from "../models/conversations/conversationModel.js";
import FriendRequests, { FriendRequestStatus } from "../models/friendRequests/friendRequestModel.js";
import { decryptMessageDocument, buildEncryptedMessageContent, type IMessageAttachment } from "../utils/messageCrypto.js";
import Users from "../models/users/usersModel.js";

// Map userId → Set<socketId>
const onlineUsers = new Map<string, Set<string>>();

function addOnlineUser(userId: string, socketId: string) {
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId)!.add(socketId);
}

function removeOnlineUser(userId: string, socketId: string) {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) onlineUsers.delete(userId);
}

function getSocketIds(userId: string): string[] {
    return Array.from(onlineUsers.get(userId) ?? []);
}

export function isUserOnline(userId: string): boolean {
    return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
}

type SendMessagePayload = {
    conversationId: string;
    content?: string;
    type?: "text" | "image" | "file";
    attachment?: IMessageAttachment | null;
    replyTo?: string | null;
};

type TypingPayload = { conversationId: string; isTyping: boolean };
type DeleteMessagePayload = { messageId: string };
type EditMessagePayload = { messageId: string; content: string };
type ReactMessagePayload = { messageId: string; emoji: string };
type PinMessagePayload = { messageId: string };

// ── Call payload types ──
type CallOfferPayload = {
    targetUserId: string;
    offer: RTCSessionDescriptionInit;
    callType: "audio" | "video";
};
type CallAnswerPayload = {
    targetUserId: string;
    answer: RTCSessionDescriptionInit;
};
type CallIceCandidatePayload = {
    targetUserId: string;
    candidate: RTCIceCandidateInit;
};
type CallEndPayload = {
    targetUserId: string;
};
type CallRejectPayload = {
    targetUserId: string;
};

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

export function initSocket(io: SocketIOServer) {
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
        notifyFriendsOnlineStatus(io, userId, true);
        socket.join(`user:${userId}`);

        // ── friends:get_online ──
        socket.on("friends:get_online", async () => {
            try {
                const requests = await FriendRequests.find({
                    status: FriendRequestStatus.Accepted,
                    $or: [{ sender: userId }, { receiver: userId }],
                });
                const friendIds = requests.map((r) => (r.sender.toString() === userId ? r.receiver.toString() : r.sender.toString()));
                const onlineStatus = friendIds.reduce<Record<string, boolean>>((acc, id) => {
                    acc[id] = isUserOnline(id);
                    return acc;
                }, {});
                socket.emit("friends:online_status", onlineStatus);
            } catch (err) {
                console.error("friends:get_online error:", err);
            }
        });

        // ── conversation:join ──
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

        // ── conversation:leave ──
        socket.on("conversation:leave", (conversationId: string) => {
            socket.leave(`conversation:${conversationId}`);
        });

        // ── message:send ──
        socket.on("message:send", async (payload: SendMessagePayload) => {
            const { conversationId, content = "", type = "text", attachment = null, replyTo = null } = payload;
            const normalizedText = content.trim();
            const normalizedType = attachment ? (attachment.mimeType.startsWith("image/") ? "image" : "file") : type;

            if (!conversationId) return;
            if (!normalizedText && !attachment) return;

            try {
                const conversation = await Conversations.findById(conversationId);
                if (!conversation) return;

                const isParticipant = conversation.participants.some((p) => p.toString() === userId);
                if (!isParticipant) return;

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

                // ── Block check ──
                const [senderUser, recipientUser] = await Promise.all([Users.findById(userId).select("blockedUsers").lean(), Users.findById(otherParticipant).select("blockedUsers").lean()]);

                const senderBlockedRecipient = senderUser?.blockedUsers?.some((id) => id.toString() === otherParticipant.toString()) ?? false;
                const recipientBlockedSender = recipientUser?.blockedUsers?.some((id) => id.toString() === userId) ?? false;

                if (senderBlockedRecipient) {
                    socket.emit("message:error", { code: "BLOCKED_BY_YOU", message: "Bạn đã chặn người này. Hãy bỏ chặn để nhắn tin." });
                    return;
                }
                if (recipientBlockedSender) {
                    socket.emit("message:error", { code: "BLOCKED_BY_THEM", message: "Bạn không thể nhắn tin cho người này." });
                    return;
                }

                const encryptedContent = buildEncryptedMessageContent(normalizedText, attachment);

                const message = await Messages.create({
                    conversationId,
                    sender: userId,
                    content: encryptedContent,
                    type: normalizedType,
                    readBy: [userId],
                    replyTo: replyTo || null,
                });

                const populatedMessage = await message.populate(messagePopulate);
                const plainMessage = decryptMessageDocument(populatedMessage.toObject());

                await Conversations.findByIdAndUpdate(conversationId, {
                    lastMessage: message._id,
                    lastMessageAt: message.createdAt,
                });

                io.to(`conversation:${conversationId}`).emit("message:new", plainMessage);

                const recipientSocketIds = getSocketIds(otherParticipant.toString());
                const isRecipientInRoom = recipientSocketIds.some((sid) => {
                    const recipientSocket = io.sockets.sockets.get(sid);
                    return recipientSocket?.rooms.has(`conversation:${conversationId}`);
                });

                if (!isRecipientInRoom) {
                    const updatedConversation = await Conversations.findById(conversationId)
                        .populate("participants", "-password -refreshToken")
                        .populate({ path: "lastMessage", populate: { path: "sender", select: "-password -refreshToken" } });

                    if (updatedConversation) {
                        const plainConversation = updatedConversation.toObject() as any;
                        if (plainConversation.lastMessage) {
                            plainConversation.lastMessage = decryptMessageDocument(plainConversation.lastMessage);
                        }
                        io.to(`user:${otherParticipant}`).emit("conversation:updated", plainConversation);
                    }
                }
            } catch (err) {
                console.error("message:send error:", err);
                socket.emit("message:error", { message: "Failed to send message" });
            }
        });

        // ── message:delete ──
        socket.on("message:delete", async (payload: DeleteMessagePayload) => {
            const { messageId } = payload;
            if (!messageId) return;

            try {
                const message = await Messages.findById(messageId);
                if (!message) return;

                if (message.sender.toString() !== userId) {
                    socket.emit("message:error", { message: "You can only delete your own messages" });
                    return;
                }

                if (message.isDeleted) return;

                await Messages.findByIdAndUpdate(messageId, {
                    isDeleted: true,
                    deletedAt: new Date(),
                });

                io.to(`conversation:${message.conversationId.toString()}`).emit("message:deleted", {
                    messageId,
                    conversationId: message.conversationId.toString(),
                });
            } catch (err) {
                console.error("message:delete error:", err);
                socket.emit("message:error", { message: "Failed to delete message" });
            }
        });

        // ── message:edit ──
        socket.on("message:edit", async (payload: EditMessagePayload) => {
            const { messageId, content } = payload;
            if (!messageId || !content?.trim()) return;

            try {
                const message = await Messages.findById(messageId);
                if (!message) return;

                if (message.sender.toString() !== userId) {
                    socket.emit("message:error", { message: "You can only edit your own messages" });
                    return;
                }

                if (message.isDeleted) return;
                if (message.type !== "text") {
                    socket.emit("message:error", { message: "Only text messages can be edited" });
                    return;
                }

                const encryptedContent = buildEncryptedMessageContent(content.trim(), null);

                const updated = await Messages.findByIdAndUpdate(messageId, { content: encryptedContent, editedAt: new Date() }, { new: true }).populate(messagePopulate);

                if (!updated) return;

                const plainMessage = decryptMessageDocument(updated.toObject());

                io.to(`conversation:${message.conversationId.toString()}`).emit("message:edited", plainMessage);

                const conv = await Conversations.findById(message.conversationId);
                if (conv) {
                    const other = conv.participants.find((p) => p.toString() !== userId);
                    if (other) {
                        io.to(`user:${other.toString()}`).emit("message:edited", plainMessage);
                    }
                }
            } catch (err) {
                console.error("message:edit error:", err);
                socket.emit("message:error", { message: "Failed to edit message" });
            }
        });

        // ── message:react ──
        socket.on("message:react", async (payload: ReactMessagePayload) => {
            const { messageId, emoji } = payload;
            if (!messageId || !emoji) return;

            try {
                const message = await Messages.findById(messageId);
                if (!message) return;
                if (message.isDeleted) return;

                const existingIndex = (message.reactions as any[]).findIndex((r: any) => r.userId.toString() === userId && r.emoji === emoji);

                let updated;
                if (existingIndex >= 0) {
                    updated = await Messages.findByIdAndUpdate(messageId, { $pull: { reactions: { userId, emoji } } }, { new: true }).populate(messagePopulate);
                } else {
                    await Messages.findByIdAndUpdate(messageId, { $pull: { reactions: { userId } } });
                    updated = await Messages.findByIdAndUpdate(messageId, { $push: { reactions: { emoji, userId } } }, { new: true }).populate(messagePopulate);
                }

                if (!updated) return;

                const plainMessage = decryptMessageDocument(updated.toObject());
                io.to(`conversation:${message.conversationId.toString()}`).emit("message:reacted", plainMessage);

                const reactConv = await Conversations.findById(message.conversationId);
                if (reactConv) {
                    const reactOther = reactConv.participants.find((p) => p.toString() !== userId);
                    if (reactOther) {
                        io.to(`user:${reactOther.toString()}`).emit("message:reacted", plainMessage);
                    }
                }
            } catch (err) {
                console.error("message:react error:", err);
                socket.emit("message:error", { message: "Failed to react to message" });
            }
        });

        // ── message:pin ──
        socket.on("message:pin", async (payload: PinMessagePayload) => {
            const { messageId } = payload;
            if (!messageId) return;

            try {
                const message = await Messages.findById(messageId);
                if (!message) return;
                if (message.isDeleted) return;

                const conversation = await Conversations.findById(message.conversationId);
                if (!conversation) return;
                const isParticipant = conversation.participants.some((p) => p.toString() === userId);
                if (!isParticipant) return;

                if (!message.isPinned) {
                    const pinnedCount = await Messages.countDocuments({
                        conversationId: message.conversationId,
                        isPinned: true,
                        isDeleted: { $ne: true },
                    });
                    if (pinnedCount >= 3) {
                        socket.emit("message:error", { message: "Chỉ được ghim tối đa 3 tin nhắn" });
                        return;
                    }
                }

                const updated = await Messages.findByIdAndUpdate(messageId, { isPinned: !message.isPinned }, { new: true }).populate(messagePopulate);

                if (!updated) return;

                const plainMessage = decryptMessageDocument(updated.toObject());
                io.to(`conversation:${message.conversationId.toString()}`).emit("message:pinned", plainMessage);

                const pinOther = conversation.participants.find((p) => p.toString() !== userId);
                if (pinOther) {
                    io.to(`user:${pinOther.toString()}`).emit("message:pinned", plainMessage);
                }
            } catch (err) {
                console.error("message:pin error:", err);
                socket.emit("message:error", { message: "Failed to pin message" });
            }
        });

        // ── message:typing ──
        socket.on("message:typing", (payload: TypingPayload) => {
            const { conversationId, isTyping } = payload;
            if (!conversationId) return;
            socket.to(`conversation:${conversationId}`).emit("message:typing", { userId, conversationId, isTyping });
        });

        // ════════════════════════════════════════════════════════════════
        // ── CALL SIGNALING ──────────────────────────────────────────────
        // ════════════════════════════════════════════════════════════════

        /**
         * Caller → BE → Callee
         * Gửi offer WebRTC đến người nhận kèm thông tin người gọi
         */
        socket.on("call:offer", async (payload: CallOfferPayload) => {
            const { targetUserId, offer, callType } = payload;
            if (!targetUserId || !offer) return;

            try {
                const caller = await Users.findById(userId).select("username avatar").lean();
                const callerName = (caller as any)?.username ?? "Người dùng";
                const callerAvatar = (caller as any)?.avatar ?? null;

                // Chuyển tiếp offer tới tất cả socket của người nhận
                io.to(`user:${targetUserId}`).emit("call:incoming", {
                    from: userId,
                    fromName: callerName,
                    fromAvatar: callerAvatar,
                    offer,
                    callType,
                });
            } catch (err) {
                console.error("call:offer error:", err);
            }
        });

        /**
         * Callee → BE → Caller
         * Gửi answer WebRTC ngược lại cho người gọi
         */
        socket.on("call:answer", (payload: CallAnswerPayload) => {
            const { targetUserId, answer } = payload;
            if (!targetUserId || !answer) return;

            io.to(`user:${targetUserId}`).emit("call:answered", {
                from: userId,
                answer,
            });
        });

        /**
         * Cả hai bên → BE → bên kia
         * Trao đổi ICE candidates để thiết lập kết nối P2P
         */
        socket.on("call:ice-candidate", (payload: CallIceCandidatePayload) => {
            const { targetUserId, candidate } = payload;
            if (!targetUserId || !candidate) return;

            io.to(`user:${targetUserId}`).emit("call:ice-candidate", {
                from: userId,
                candidate,
            });
        });

        /**
         * Người kết thúc cuộc gọi → BE → bên kia
         */
        socket.on("call:end", (payload: CallEndPayload) => {
            const { targetUserId } = payload;
            if (!targetUserId) return;

            io.to(`user:${targetUserId}`).emit("call:ended", {
                from: userId,
            });
        });

        /**
         * Callee từ chối cuộc gọi đến → BE → Caller
         */
        socket.on("call:reject", (payload: CallRejectPayload) => {
            const { targetUserId } = payload;
            if (!targetUserId) return;

            io.to(`user:${targetUserId}`).emit("call:rejected", {
                from: userId,
            });
        });

        // ════════════════════════════════════════════════════════════════
        // ── disconnect ──────────────────────────────────────────────────
        // ════════════════════════════════════════════════════════════════
        socket.on("disconnect", () => {
            removeOnlineUser(userId, socket.id);
            notifyFriendsOnlineStatus(io, userId, false);
        });
    });
}

async function notifyFriendsOnlineStatus(io: SocketIOServer, userId: string, isOnline: boolean) {
    try {
        const requests = await FriendRequests.find({
            status: FriendRequestStatus.Accepted,
            $or: [{ sender: userId }, { receiver: userId }],
        });
        requests.forEach((r) => {
            const friendId = r.sender.toString() === userId ? r.receiver.toString() : r.sender.toString();
            io.to(`user:${friendId}`).emit("friend:online_status", { userId, isOnline });
        });
    } catch (err) {
        console.error("notifyFriendsOnlineStatus error:", err);
    }
}
