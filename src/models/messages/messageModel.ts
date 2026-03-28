/** @format */

import mongoose, { Document } from "mongoose";

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
    createdAt: Date;
    updatedAt: Date;
}

const messageSchema = new mongoose.Schema<IMessage>(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Conversations",
            required: true,
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
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
                type: mongoose.Schema.Types.ObjectId,
                ref: "Users",
                default: [],
            },
        ],
    },
    { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

const Messages = mongoose.model<IMessage>("Messages", messageSchema);

export default Messages;
