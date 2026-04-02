/** @format */

import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import Messages, { MessageType } from "../models/messages/messageModel.js";
import Conversations from "../models/conversations/conversationModel.js";
import FriendRequests, { FriendRequestStatus } from "../models/friendRequests/friendRequestModel.js";
import { decryptMessageDocument, buildEncryptedMessageContent, type IMessageAttachment } from "../utils/messageCrypto.js";
import Users from "../models/users/usersModel.js";

// ✅ FIX: Map userId → Map<socketId, socket> để track tất cả connections
const onlineUsers = new Map<string, Map<string, Socket>>();

function addOnlineUser(userId: string, socketId: string, socket: Socket) {
    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Map());
    }
    onlineUsers.get(userId)!.set(socketId, socket);
    console.log(`[Socket] User ${userId} connected (socket: ${socketId}). Total sockets: ${onlineUsers.get(userId)!.size}`);
}

function removeOnlineUser(userId: string, socketId: string) {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    console.log(`[Socket] User ${userId} disconnected (socket: ${socketId}). Remaining: ${sockets.size}`);
    if (sockets.size === 0) {
        onlineUsers.delete(userId);
    }
}

// ✅ FIX: Lấy tất cả socket IDs của user
function getSocketIds(userId: string): string[] {
    const sockets = onlineUsers.get(userId);
    return sockets ? Array.from(sockets.keys()) : [];
}

export function isUserOnline(userId: string): boolean {
    const sockets = onlineUsers.get(userId);
    return sockets ? sockets.size > 0 : false;
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

type CallConnectedPayload = {
    callId: string;
    connectedAt: string;
    callerId: string;
    receiverId: string;
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

// ✅ NEW: Track active calls with timeout
const activeCallTimers = new Map<string, NodeJS.Timeout>();

type CallStatus = "ended" | "rejected" | "missed" | "cancelled" | "offline";

type CallSession = {
    conversationId: string;
    callerId: string;
    calleeId: string;
    callType: "audio" | "video";
    startedAt: number;
    connectedAt?: number;
};

const activeCallSessions = new Map<string, CallSession>();

function getCallKey(userA: string, userB: string) {
    return [userA, userB].sort().join(":");
}

function formatCallDuration(totalSeconds: number) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function buildCallSummary(status: CallStatus, callType: "audio" | "video", durationSeconds = 0) {
    const kind = callType === "video" ? "video call" : "audio call";

    switch (status) {
        case "ended":
            return `Đã gọi ${kind} ${formatCallDuration(durationSeconds)}`;
        case "rejected":
            return "Cuộc gọi bị từ chối";
        case "missed":
            return "Cuộc gọi nhỡ";
        case "cancelled":
            return "Cuộc gọi đã bị hủy";
        case "offline":
            return "Cuộc gọi không thực hiện được";
        default:
            return "Cuộc gọi";
    }
}

async function resolveOrCreateConversation(userA: string, userB: string) {
    let conversation = await Conversations.findOne({
        participants: { $all: [userA, userB] },
    });

    if (!conversation) {
        conversation = await Conversations.create({
            participants: [userA, userB],
        });
    }

    return conversation;
}

async function emitConversationUpdates(io: SocketIOServer, conversationId: string, participantIds: string[]) {
    const updatedConversation = await Conversations.findById(conversationId)
        .populate("participants", "-password -refreshToken")
        .populate({
            path: "lastMessage",
            populate: { path: "sender", select: "-password -refreshToken" },
        });

    if (!updatedConversation) return;

    const plainConversation = updatedConversation.toObject() as any;
    if (plainConversation.lastMessage) {
        plainConversation.lastMessage = decryptMessageDocument(plainConversation.lastMessage);
    }
    // Convert nicknames Map → plain object
    if (updatedConversation.nicknames instanceof Map) {
        plainConversation.nicknames = Object.fromEntries(updatedConversation.nicknames);
    }

    // Luôn emit tới tất cả participants (kể cả đang trong room) để ChatsPage cập nhật
    for (const participantId of participantIds) {
        io.to(`user:${participantId}`).emit("conversation:updated", plainConversation);
    }
}

async function createCallLogMessage(io: SocketIOServer, session: CallSession, status: CallStatus, endedBy: string) {
    const endedAt = Date.now();
    const durationSeconds = status === "ended" && session.connectedAt ? Math.max(0, Math.floor((endedAt - session.connectedAt) / 1000)) : 0;

    const message = await Messages.create({
        conversationId: session.conversationId,
        sender: session.callerId,
        content: buildEncryptedMessageContent(buildCallSummary(status, session.callType, durationSeconds), null),
        type: MessageType.Call,
        readBy: [endedBy],
        callMeta: {
            status,
            callType: session.callType,
            durationSeconds,
            startedAt: new Date(session.connectedAt ?? session.startedAt),
            endedAt: new Date(endedAt),
            initiatorId: session.callerId,
            recipientId: session.calleeId,
            endedBy,
        },
    });

    const populatedMessage = await message.populate(messagePopulate);
    const plainMessage = decryptMessageDocument(populatedMessage.toObject());

    await Conversations.findByIdAndUpdate(session.conversationId, {
        lastMessage: message._id,
        lastMessageAt: message.createdAt,
    });

    io.to(`conversation:${session.conversationId}`).emit("message:new", plainMessage);
    await emitConversationUpdates(io, session.conversationId, [session.callerId, session.calleeId]);
}

function buildCallId(userA: string, userB: string) {
    return [userA, userB].sort().join(":");
}

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

        // ✅ FIX: Pass socket instance để store tất cả connections
        addOnlineUser(userId, socket.id, socket);
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

                // ── Group conversation: skip friend/block check ──
                if (!(conversation as any).isGroup) {
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

                // Emit conversation:updated tới TẤT CẢ participants (kể cả đang trong room) để ChatsPage cập nhật real-time
                const updatedConversation = await Conversations.findById(conversationId)
                    .populate("participants", "-password -refreshToken")
                    .populate({ path: "lastMessage", populate: { path: "sender", select: "-password -refreshToken" } });

                if (updatedConversation) {
                    const plainConversation = updatedConversation.toObject() as any;
                    if (plainConversation.lastMessage) {
                        plainConversation.lastMessage = decryptMessageDocument(plainConversation.lastMessage);
                    }
                    if (updatedConversation.nicknames instanceof Map) {
                        plainConversation.nicknames = Object.fromEntries(updatedConversation.nicknames);
                    }

                    for (const participantId of conversation.participants) {
                        io.to(`user:${participantId}`).emit("conversation:updated", plainConversation);
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

                if (message.sender?.toString() !== userId) {
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

                if (message.sender?.toString() !== userId) {
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
        socket.on("message:typing", async (payload: TypingPayload) => {
            const { conversationId, isTyping } = payload;
            if (!conversationId) return;

            // Emit tới những ai đang trong room (ChatContent đang mở)
            socket.to(`conversation:${conversationId}`).emit("message:typing", { userId, conversationId, isTyping });

            // Emit tới tất cả participants qua user room (cho ChatsPage dù chưa mở chat)
            try {
                const conversation = await Conversations.findById(conversationId).select("participants").lean();
                if (conversation) {
                    for (const participantId of conversation.participants) {
                        if (participantId.toString() !== userId) {
                            io.to(`user:${participantId}`).emit("message:typing", { userId, conversationId, isTyping });
                        }
                    }
                }
            } catch {
                /* ignore */
            }
        });

        // ════════════════════════════════════════════════════════════════
        // ── CALL SIGNALING ──────────────────────────────────────────────
        // ════════════════════════════════════════════════════════════════

        socket.on("call:offer", async (payload: CallOfferPayload) => {
            const { targetUserId, offer, callType } = payload;
            if (!targetUserId || !offer) return;

            try {
                if (targetUserId === userId) {
                    socket.emit("call:error", { message: "Không thể tự gọi cho chính mình" });
                    return;
                }

                const conversation = await resolveOrCreateConversation(userId, targetUserId);

                if (!isUserOnline(targetUserId)) {
                    const offlineSession: CallSession = {
                        conversationId: conversation._id.toString(),
                        callerId: userId,
                        calleeId: targetUserId,
                        callType,
                        startedAt: Date.now(),
                    };

                    await createCallLogMessage(io, offlineSession, "offline", userId);

                    socket.emit("call:recipient_offline", {
                        targetUserId,
                        message: "Người nhận không đang online",
                    });
                    return;
                }

                const stillFriends = await FriendRequests.findOne({
                    status: FriendRequestStatus.Accepted,
                    $or: [
                        { sender: userId, receiver: targetUserId },
                        { sender: targetUserId, receiver: userId },
                    ],
                });

                if (!stillFriends) {
                    socket.emit("call:error", { message: "Chỉ có thể gọi cho bạn bè" });
                    return;
                }

                const [callerUser, targetUser] = await Promise.all([Users.findById(userId).select("blockedUsers").lean(), Users.findById(targetUserId).select("blockedUsers").lean()]);

                const callerBlockedTarget = callerUser?.blockedUsers?.some((id) => id.toString() === targetUserId.toString()) ?? false;
                const targetBlockedCaller = targetUser?.blockedUsers?.some((id) => id.toString() === userId.toString()) ?? false;

                if (callerBlockedTarget) {
                    socket.emit("call:error", { code: "BLOCKED_BY_YOU", message: "Bạn đã chặn người này. Hãy bỏ chặn để gọi." });
                    return;
                }

                if (targetBlockedCaller) {
                    socket.emit("call:error", { code: "BLOCKED_BY_THEM", message: "Bạn không thể gọi cho người này." });
                    return;
                }

                const caller = await Users.findById(userId).select("username avatar").lean();
                const callerName = (caller as any)?.username ?? "Người dùng";
                const callerAvatar = (caller as any)?.avatar ?? null;

                const callId = getCallKey(userId, targetUserId);

                const existingTimer = activeCallTimers.get(callId);
                if (existingTimer) clearTimeout(existingTimer);

                activeCallSessions.set(callId, {
                    conversationId: conversation._id.toString(),
                    callerId: userId,
                    calleeId: targetUserId,
                    callType,
                    startedAt: Date.now(),
                });

                const timer = setTimeout(() => {
                    void (async () => {
                        const session = activeCallSessions.get(callId);
                        activeCallTimers.delete(callId);

                        if (!session) return;

                        activeCallSessions.delete(callId);
                        await createCallLogMessage(io, session, "missed", session.calleeId);

                        io.to(`user:${session.callerId}`).emit("call:timeout", {
                            targetUserId: session.calleeId,
                            message: "Cuộc gọi đã hết hạn",
                        });
                        io.to(`user:${session.calleeId}`).emit("call:timeout", {
                            targetUserId: session.callerId,
                            message: "Cuộc gọi đã hết hạn",
                        });
                    })().catch((err) => {
                        console.error("[Call] timeout log error:", err);
                    });
                }, 30000);

                activeCallTimers.set(callId, timer);

                io.to(`user:${targetUserId}`).emit("call:incoming", {
                    from: userId,
                    fromName: callerName,
                    fromAvatar: callerAvatar,
                    offer,
                    callType,
                });

                console.log(`[Call] Offer sent from ${userId} to ${targetUserId}`);
            } catch (err) {
                console.error("call:offer error:", err);
                socket.emit("call:error", { message: "Failed to send call offer" });
            }
        });

        socket.on("call:answer", (payload: CallAnswerPayload) => {
            const { targetUserId, answer } = payload;
            if (!targetUserId || !answer) return;

            try {
                const callId = getCallKey(targetUserId, userId);
                const timer = activeCallTimers.get(callId);

                if (timer) {
                    clearTimeout(timer);
                    activeCallTimers.delete(callId);
                }

                const session = activeCallSessions.get(callId);
                if (session) {
                    session.connectedAt = Date.now();
                    activeCallSessions.set(callId, session);
                }

                const connectedAt = new Date().toISOString();
                const connectedPayload: CallConnectedPayload = {
                    callId: buildCallId(targetUserId, userId),
                    connectedAt,
                    callerId: targetUserId,
                    receiverId: userId,
                };

                io.to(`user:${targetUserId}`).emit("call:answered", {
                    from: userId,
                    answer,
                    connectedAt,
                    callId: connectedPayload.callId,
                });

                io.to(`user:${targetUserId}`).emit("call:connected", connectedPayload);
                io.to(`user:${userId}`).emit("call:connected", connectedPayload);

                console.log(`[Call] Answer sent from ${userId} to ${targetUserId}`);
                console.log(`[Call] Call connected between ${targetUserId} and ${userId} at ${connectedAt}`);
            } catch (err) {
                console.error("call:answer error:", err);
            }
        });

        socket.on("call:ice-candidate", (payload: CallIceCandidatePayload) => {
            const { targetUserId, candidate } = payload;
            if (!targetUserId || !candidate) return;

            io.to(`user:${targetUserId}`).emit("call:ice-candidate", {
                from: userId,
                candidate,
            });
        });

        socket.on("call:end", async (payload: CallEndPayload) => {
            const { targetUserId } = payload;
            if (!targetUserId) return;

            try {
                const callId = getCallKey(userId, targetUserId);

                const timer1 = activeCallTimers.get(callId);
                if (timer1) {
                    clearTimeout(timer1);
                    activeCallTimers.delete(callId);
                }

                const session = activeCallSessions.get(callId);
                if (session) {
                    const status: CallStatus = session.connectedAt ? "ended" : userId === session.callerId ? "cancelled" : "rejected";

                    activeCallSessions.delete(callId);
                    await createCallLogMessage(io, session, status, userId);
                }

                io.to(`user:${targetUserId}`).emit("call:ended", {
                    from: userId,
                });

                console.log(`[Call] Call ended between ${userId} and ${targetUserId}`);
            } catch (err) {
                console.error("call:end error:", err);
            }
        });

        socket.on("call:reject", async (payload: CallRejectPayload) => {
            const { targetUserId } = payload;
            if (!targetUserId) return;

            try {
                const callId = getCallKey(targetUserId, userId);
                const timer = activeCallTimers.get(callId);
                if (timer) {
                    clearTimeout(timer);
                    activeCallTimers.delete(callId);
                }

                const session = activeCallSessions.get(callId);
                if (session) {
                    activeCallSessions.delete(callId);
                    await createCallLogMessage(io, session, "rejected", userId);
                }

                io.to(`user:${targetUserId}`).emit("call:rejected", {
                    from: userId,
                });

                console.log(`[Call] Call rejected by ${userId} from ${targetUserId}`);
            } catch (err) {
                console.error("call:reject error:", err);
            }
        });

        socket.on("disconnect", () => {
            removeOnlineUser(userId, socket.id);
            notifyFriendsOnlineStatus(io, userId, isUserOnline(userId));

            for (const [key, timer] of activeCallTimers.entries()) {
                const [a, b] = key.split(":");
                if (a === userId || b === userId) {
                    clearTimeout(timer);
                    activeCallTimers.delete(key);
                }
            }

            for (const [key, session] of activeCallSessions.entries()) {
                if (session.callerId === userId || session.calleeId === userId) {
                    activeCallSessions.delete(key);
                }
            }
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
