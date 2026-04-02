/** @format */

import mongoose, { type Document } from "mongoose";

export interface IConversation extends Document {
    participants: mongoose.Types.ObjectId[];
    lastMessage: mongoose.Types.ObjectId | null;
    lastMessageAt: Date | null;
    isGroup: boolean;
    groupId: mongoose.Types.ObjectId | null;
    nicknames: Map<string, string>; // userId → nickname
    createdAt: Date;
    updatedAt: Date;
}

const conversationSchema = new mongoose.Schema<IConversation>(
    {
        participants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Users",
                required: true,
            },
        ],
        lastMessage: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Messages",
            default: null,
        },
        lastMessageAt: {
            type: Date,
            default: null,
        },
        isGroup: {
            type: Boolean,
            default: false,
        },
        groupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Groups",
            default: null,
        },
        nicknames: {
            type: Map,
            of: String,
            default: {},
        },
    },
    { timestamps: true },
);

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });

const Conversations = mongoose.model<IConversation>("Conversations", conversationSchema);

export default Conversations;
