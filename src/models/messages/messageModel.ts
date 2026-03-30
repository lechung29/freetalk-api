/** @format */

import mongoose, { Schema, type InferSchemaType } from "mongoose";

export enum MessageType {
    Text = "text",
    Image = "image",
    File = "file",
    Call = "call",
}

export type CallMessageStatus = "ended" | "rejected" | "missed" | "cancelled" | "offline";

export interface ICallMessageMeta {
    status: CallMessageStatus;
    callType: "audio" | "video";
    durationSeconds: number;
    startedAt?: Date;
    endedAt?: Date;
    initiatorId?: mongoose.Types.ObjectId | null;
    recipientId?: mongoose.Types.ObjectId | null;
    endedBy?: mongoose.Types.ObjectId | null;
}

export interface IMessage extends Document {
    conversationId: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    type: MessageType;
    content: string;
    readBy: mongoose.Types.ObjectId[];
    isDeleted: boolean;
    deletedAt?: Date;
    editedAt?: Date;
    isPinned: boolean;
    replyTo?: mongoose.Types.ObjectId;
    reactions: { emoji: string; userId: mongoose.Types.ObjectId }[];
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
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: MessageType,
            default: MessageType.Text,
        },
        content: {
            type: String,
            required: true,
        },
        readBy: [
            {
                type: Schema.Types.ObjectId,
                ref: "User",
                default: [],
            },
        ],
        isDeleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: {
            type: Date,
        },
        editedAt: {
            type: Date,
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
                enum: ["ended", "rejected", "missed", "cancelled", "offline"],
                default: null,
            },
            callType: {
                type: String,
                enum: ["audio", "video"],
                default: null,
            },
            durationSeconds: {
                type: Number,
                default: 0,
            },
            startedAt: {
                type: Date,
                default: null,
            },
            endedAt: {
                type: Date,
                default: null,
            },
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
    {
        timestamps: true,
    },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

type MessageDocument = InferSchemaType<typeof messageSchema>;
const Messages = mongoose.model<MessageDocument>("Messages", messageSchema);

export default Messages;
