/** @format */

import mongoose, { Document } from "mongoose";

// ─── Constants (shared với Zod schemas) ──────────────────────────────────────
export const NOTIFICATION_TYPES = [
    "friend_request",
    "friend_request_accepted",
    "friend_request_declined",
    "friend_request_cancelled",
    "friend_removed",
    "group_invite",
    "group_member_removed",
    "message",
    "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification extends Document {
    recipient: mongoose.Types.ObjectId;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    isRead: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const notificationSchema = new mongoose.Schema<INotification>(
    {
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: NOTIFICATION_TYPES,
            required: true,
        },
        title: {
            type: String,
            required: true,
        },
        body: {
            type: String,
            required: true,
        },
        data: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        isRead: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true },
);

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const Notifications = mongoose.model<INotification>("Notifications", notificationSchema);

export default Notifications;
