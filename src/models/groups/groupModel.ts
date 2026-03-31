/** @format */

import mongoose, { Document } from "mongoose";

export type GroupMemberRole = "owner" | "admin" | "member";
export type GroupMemberStatus = "pending" | "accepted" | "declined";

export interface IGroupMember {
    user: mongoose.Types.ObjectId;
    role: GroupMemberRole;
    status: GroupMemberStatus;
    invitedBy?: mongoose.Types.ObjectId | null;
    invitedAt: Date;
    respondedAt?: Date | null;
}

export interface IGroup extends Document {
    name: string;
    description?: string | null;
    avatar?: string | null;
    owner: mongoose.Types.ObjectId;
    members: IGroupMember[];
    createdAt: Date;
    updatedAt: Date;
}

const groupMemberSchema = new mongoose.Schema<IGroupMember>(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        role: {
            type: String,
            enum: ["owner", "admin", "member"],
            default: "member",
        },
        status: {
            type: String,
            enum: ["pending", "accepted", "declined"],
            default: "pending",
        },
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            default: null,
        },
        invitedAt: {
            type: Date,
            default: Date.now,
        },
        respondedAt: {
            type: Date,
            default: null,
        },
    },
    { _id: false },
);

const groupSchema = new mongoose.Schema<IGroup>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: "",
            trim: true,
        },
        avatar: {
            type: String,
            default: null,
        },
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        members: {
            type: [groupMemberSchema],
            default: [],
        },
    },
    { timestamps: true, minimize: false },
);

groupSchema.index({ owner: 1 });
groupSchema.index({ "members.user": 1 });

const Groups = mongoose.model<IGroup>("Groups", groupSchema);

export default Groups;
