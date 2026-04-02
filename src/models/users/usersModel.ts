/** @format */

import mongoose, { type Document } from "mongoose";

export enum IResponseStatus {
    Error = 0,
    Success = 1,
}

export const USER_STATUSES = [1, 2] as const;
export enum IUserStatus {
    Activated = 1,
    Deleted = 2,
}

export interface IUserData extends Document {
    username: string;
    email: string;
    password: string;
    avatar: string;
    status: IUserStatus;
    location: string;
    timezone: string;
    blockedUsers: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
    refreshToken: string[];
}

export type IUserInfo = {
    id: string;
    username: string;
    email: string;
    avatar: string;
    status: IUserStatus;
    location: string;
    timezone: string;
    blockedUsers: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
};

export const defaultAvatar: string = "https://www.pngkey.com/png/full/115-1150420_avatar-png-pic-male-avatar-icon-png.png";

const userSchema = new mongoose.Schema<IUserData>(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: false },
        avatar: { type: String, required: false, default: defaultAvatar },
        status: {
            type: Number,
            required: false,
            enum: USER_STATUSES,
            default: IUserStatus.Activated,
        },
        location: { type: String, required: false, default: "" },
        timezone: { type: String, required: false, default: "" },
        blockedUsers: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Users",
                default: [],
            },
        ],
        refreshToken: [{ type: String, required: false, default: [] }],
    },
    { timestamps: true, minimize: false },
);

const Users = mongoose.model<IUserData>("Users", userSchema);

export default Users;
