/** @format */

import mongoose, { Document } from "mongoose";

export const FRIEND_REQUEST_STATUSES = ["pending", "accepted", "declined"] as const;
export type FriendRequestStatusValue = (typeof FRIEND_REQUEST_STATUSES)[number];

export enum FriendRequestStatus {
    Pending = "pending",
    Accepted = "accepted",
    Declined = "declined",
}

export interface IFriendRequest extends Document {
    sender: mongoose.Types.ObjectId;
    receiver: mongoose.Types.ObjectId;
    status: FriendRequestStatusValue;
    createdAt: Date;
    updatedAt: Date;
}

const friendRequestSchema = new mongoose.Schema<IFriendRequest>(
    {
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        receiver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        status: {
            type: String,
            enum: FRIEND_REQUEST_STATUSES,
            default: "pending" satisfies FriendRequestStatusValue,
        },
    },
    { timestamps: true },
);

friendRequestSchema.index({ sender: 1, receiver: 1 }, { unique: true });

const FriendRequests = mongoose.model<IFriendRequest>("FriendRequests", friendRequestSchema);

export default FriendRequests;
