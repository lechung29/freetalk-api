/** @format */

import type { Request, Response, RequestHandler } from "express";
import Users, { IResponseStatus, IUserStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";
import type { UpdateUserBody } from "../../schemas/user.schema.js";

const searchUsers: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const requesterId = req.user?.id;

    if (!requesterId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }
    const search = (req.query.search as string).trim();

    const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyword = escapeRegex(search);

    try {
        const users = await Users.find({
            _id: { $ne: requesterId },
            status: { $ne: IUserStatus.Deleted },
            $or: [{ username: { $regex: keyword, $options: "i" } }, { email: { $regex: keyword, $options: "i" } }],
        })
            .select("-password -refreshToken")
            .limit(20)
            .lean();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Users fetched successfully",
            data: users,
        });
    } catch (error) {
        console.error("Search users error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const getUserById: RequestHandler = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const user = await Users.findById(id).select("-password -refreshToken").lean();

        if (!user || user.status === IUserStatus.Deleted) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "User not found",
            });
        }

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "User retrieved successfully",
            data: user,
        });
    } catch (error) {
        console.error("Get user by id error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const updateUser: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const requesterId = req.user?.id;
    const { id } = req.params;

    if (!requesterId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }

    if (requesterId !== id) {
        return res.status(403).send({
            status: IResponseStatus.Error,
            message: "You are not allowed to update another user's profile",
        });
    }

    const { username, avatar, location, timezone } = req.body as UpdateUserBody;

    try {
        const user = await Users.findById(id);

        if (!user || user.status === IUserStatus.Deleted) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "User not found" });
        }

        if (username !== undefined) user.username = username;
        if (avatar !== undefined) user.avatar = avatar;
        if (location !== undefined) user.location = location;
        if (timezone !== undefined) user.timezone = timezone.trim();

        await user.save();

        const { password, refreshToken, ...updatedUser } = user.toObject();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Your profile has been updated successfully",
            data: updatedUser,
        });
    } catch (error) {
        console.error("Update user error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const deleteUser: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const requesterId = req.user?.id;

    if (!requesterId) {
        return res.status(401).send({ status: IResponseStatus.Error, message: "Unauthorized" });
    }

    try {
        const user = await Users.findById(requesterId);

        if (!user) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "User not found" });
        }

        if (user.status === IUserStatus.Deleted) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Account already deleted",
            });
        }

        user.status = IUserStatus.Deleted;
        await user.save();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Account deleted successfully",
        });
    } catch (error) {
        console.error("Delete user error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

export { updateUser, deleteUser, getUserById, searchUsers };
