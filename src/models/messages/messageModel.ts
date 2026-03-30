/** @format */

import mongoose, { Schema, type InferSchemaType } from "mongoose";

export enum MessageType {
    Text = "text",
    Image = "image",
    File = "file",
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
    },
    {
        timestamps: true,
    },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

type MessageDocument = InferSchemaType<typeof messageSchema>;
const Messages = mongoose.model<MessageDocument>("Messages", messageSchema);

export default Messages;
