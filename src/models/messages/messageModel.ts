/** @format */

import mongoose, { Schema, Document } from "mongoose";

export const MESSAGE_TYPES = ["text", "image", "file", "call", "system"] as const;
export type MessageTypeValue = (typeof MESSAGE_TYPES)[number];

export const CALL_MESSAGE_STATUSES = ["ended", "rejected", "missed", "cancelled", "offline"] as const;
export type CallMessageStatus = (typeof CALL_MESSAGE_STATUSES)[number];

export const CALL_TYPES = ["audio", "video"] as const;
export type CallType = (typeof CALL_TYPES)[number];

export enum MessageType {
    Text = "text",
    Image = "image",
    File = "file",
    Call = "call",
    System = "system",
}
export interface ICallMessageMeta {
    status: CallMessageStatus;
    callType: CallType;
    durationSeconds: number;
    startedAt?: Date | null;
    endedAt?: Date | null;
    initiatorId?: mongoose.Types.ObjectId | null;
    recipientId?: mongoose.Types.ObjectId | null;
    endedBy?: mongoose.Types.ObjectId | null;
}

export interface IReaction {
    emoji: string;
    userId: mongoose.Types.ObjectId;
}

export interface IMessage extends Document {
    conversationId: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId | null; // null cho system messages
    type: MessageTypeValue;
    content: string;
    readBy: mongoose.Types.ObjectId[];
    isDeleted: boolean;
    deletedAt?: Date | null;
    editedAt?: Date | null;
    isPinned: boolean;
    replyTo?: mongoose.Types.ObjectId | null;
    reactions: IReaction[];
    callMeta?: ICallMessageMeta | null;
    createdAt: Date;
    updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
    {
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: "Conversations",
            required: true,
            index: true,
        },
        sender: {
            type: Schema.Types.ObjectId,
            ref: "Users",
            required: false, // null cho system messages
            default: null,
            index: true,
        },
        type: {
            type: String,
            enum: MESSAGE_TYPES,
            default: "text" satisfies MessageTypeValue,
        },
        content: {
            type: String,
            required: true,
        },
        readBy: [
            {
                type: Schema.Types.ObjectId,
                ref: "Users",
                default: [],
            },
        ],
        isDeleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
        editedAt: {
            type: Date,
            default: null,
        },
        isPinned: {
            type: Boolean,
            default: false,
        },
        replyTo: {
            type: Schema.Types.ObjectId,
            ref: "Messages",
            default: null,
        },
        reactions: [
            {
                emoji: { type: String, required: true },
                userId: { type: Schema.Types.ObjectId, ref: "Users", required: true },
            },
        ],
        callMeta: {
            status: {
                type: String,
                enum: [...CALL_MESSAGE_STATUSES, null],
                default: null,
            },
            callType: {
                type: String,
                enum: [...CALL_TYPES, null],
                default: null,
            },
            durationSeconds: {
                type: Number,
                default: 0,
            },
            startedAt: { type: Date, default: null },
            endedAt: { type: Date, default: null },
            initiatorId: {
                type: Schema.Types.ObjectId,
                ref: "Users",
                default: null,
            },
            recipientId: {
                type: Schema.Types.ObjectId,
                ref: "Users",
                default: null,
            },
            endedBy: {
                type: Schema.Types.ObjectId,
                ref: "Users",
                default: null,
            },
        },
    },
    { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

const Messages = mongoose.model<IMessage>("Messages", messageSchema);

export default Messages;
