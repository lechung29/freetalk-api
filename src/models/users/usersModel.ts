/** @format */

import mongoose, { Document } from "mongoose";

export enum IResponseStatus {
    Error = 0,
    Success = 1,
}

export enum IUserStatus {
    Activated = 1,
    Deleted,
}

export type IUserInfo = Omit<IUserData, "password" | "refreshToken">;

export interface IUserData extends Document {
    username: string;
    email: string;
    password: string;
    avatar: string;
    status: IUserStatus;
    location: string;
    timezone: string;
    createdAt: Date;
    updatedAt: Date;
    refreshToken: string[];
}

export const defaultAvatar: string = "https://www.pngkey.com/png/full/115-1150420_avatar-png-pic-male-avatar-icon-png.png";

const userSchema = new mongoose.Schema<IUserData>(
    {
        username: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
        },
        password: {
            type: String,
            required: false,
        },
        avatar: {
            type: String,
            required: false,
            default: defaultAvatar,
        },
        status: {
            type: Number,
            required: false,
            enum: IUserStatus,
            default: IUserStatus.Activated,
        },
        location: {
            type: String,
            required: false,
            default: "",
        },
        timezone: {
            type: String,
            required: false,
            default: "",
        },
        refreshToken: [
            {
                type: String,
                required: false,
                default: [],
            },
        ],
    },
    { timestamps: true, minimize: false },
);

const Users = mongoose.model<IUserData>("Users", userSchema);

export default Users;
