/** @format */

import mongoose, { Document } from "mongoose";

export enum FriendRequestStatus {
    Pending = "pending",
    Accepted = "accepted",
    Declined = "declined",
}

export interface IFriendRequest extends Document {
    sender: mongoose.Types.ObjectId;
    receiver: mongoose.Types.ObjectId;
    status: FriendRequestStatus;
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
            enum: FriendRequestStatus,
            default: FriendRequestStatus.Pending,
        },
    },
    { timestamps: true },
);

// Không cho phép gửi trùng request giữa 2 người
friendRequestSchema.index({ sender: 1, receiver: 1 }, { unique: true });

const FriendRequests = mongoose.model<IFriendRequest>("FriendRequests", friendRequestSchema);

export default FriendRequests;
