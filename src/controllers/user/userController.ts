/** @format */

import type { Request, Response, RequestHandler } from "express";
import Users, { IResponseStatus, IUserStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";

const searchUsers: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const { search } = req.query;
    const requesterId = req.user?.id;

    if (!requesterId) {
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Unauthorized",
        });
    }

    if (!search || typeof search !== "string" || search.trim().length === 0) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Search query is required",
        });
    }

    const escapeRegex = (text: string) => {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    };

    const keyword = escapeRegex(search.trim());

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

const updateUser: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const requesterId = req.user?.id;

    if (!requesterId) {
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Unauthorized",
        });
    }

    if (!id || requesterId !== id) {
        return res.status(403).send({
            status: IResponseStatus.Error,
            message: "You are not allowed to update another user's profile",
        });
    }

    const objectIdRegex = /^[0-9a-fA-F]{24}$/;
    if (!objectIdRegex.test(id)) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Invalid user ID format",
        });
    }
    const { username, avatar, location, timezone } = req.body;

    if (username === undefined && avatar === undefined && location === undefined && timezone === undefined) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "At least one field must be provided for update",
        });
    }

    if (username !== undefined) {
        if (typeof username !== "string" || username.trim().length === 0) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Username is invalid",
            });
        }
        if (username.trim().length < 3) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Username must be at least 3 characters",
            });
        }
        if (username.trim().length > 50) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Username must not exceed 50 characters",
            });
        }
    }

    if (avatar !== undefined) {
        if (typeof avatar !== "string" || avatar.trim().length === 0) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Avatar URL is invalid",
            });
        }
        try {
            const url = new URL(avatar.trim());
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                return res.status(400).send({
                    status: IResponseStatus.Error,
                    message: "Avatar URL must use HTTP or HTTPS protocol",
                });
            }
        } catch {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Invalid avatar URL format",
            });
        }
        if (avatar.trim().length > 2048) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Avatar URL must not exceed 2048 characters",
            });
        }
    }

    if (location !== undefined) {
        if (typeof location !== "string") {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Location is invalid",
            });
        }
        if (location.trim().length > 300) {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Location must not exceed 300 characters",
            });
        }
    }

    if (timezone !== undefined) {
        if (typeof timezone !== "string") {
            return res.status(400).send({
                status: IResponseStatus.Error,
                message: "Timezone is invalid",
            });
        }
        if (timezone.trim().length > 0) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone.trim() });
            } catch {
                return res.status(400).send({
                    status: IResponseStatus.Error,
                    message: "Invalid timezone identifier",
                });
            }
        }
    }

    try {
        const user = await Users.findById(id);

        if (!user || user.status === IUserStatus.Deleted) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "User not found",
            });
        }

        if (username !== undefined) user.username = username.trim();
        if (avatar !== undefined) user.avatar = avatar.trim();
        if (location !== undefined) user.location = location.trim();
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

const getUserById: RequestHandler = async (req: Request, res: Response) => {
    const { id } = req.params;

    const objectIdRegex = /^[0-9a-fA-F]{24}$/;
    if (!objectIdRegex.test(id!)) {
        return res.status(400).send({
            status: IResponseStatus.Error,
            message: "Invalid user ID format",
        });
    }

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

const deleteUser: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const requesterId = req.user?.id;

    if (!requesterId) {
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Unauthorized",
        });
    }

    try {
        const user = await Users.findById(requesterId);

        if (!user) {
            return res.status(404).send({
                status: IResponseStatus.Error,
                message: "User not found",
            });
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
