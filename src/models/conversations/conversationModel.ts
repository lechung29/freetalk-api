/** @format */

import mongoose, { Document } from "mongoose";

export interface IConversation extends Document {
    participants: mongoose.Types.ObjectId[];
    lastMessage: mongoose.Types.ObjectId | null;
    lastMessageAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const conversationSchema = new mongoose.Schema<IConversation>(
    {
        // Luôn có đúng 2 participants cho DM
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
    },
    { timestamps: true },
);

// Index để tìm conversation giữa 2 người nhanh
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });

const Conversations = mongoose.model<IConversation>("Conversations", conversationSchema);

export default Conversations;
