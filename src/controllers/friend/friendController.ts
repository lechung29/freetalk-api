/** @format */

import type { Response, RequestHandler } from "express";
import mongoose from "mongoose";
import FriendRequests, { FriendRequestStatus } from "../../models/friendRequests/friendRequestModel.js";
import Users, { IResponseStatus, IUserStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// POST /api/v1/friends/request/:receiverId
// Gửi lời mời kết bạn
const sendFriendRequest: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const senderId = req.user?.id;
    const { receiverId } = req.params;

    if (!objectIdRegex.test(receiverId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid user ID" });
    }

    if (senderId === receiverId) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "You cannot send a friend request to yourself" });
    }

    try {
        const receiver = await Users.findById(receiverId);
        if (!receiver || receiver.status === IUserStatus.Deleted) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "User not found" });
        }

        // Kiểm tra đã có request chưa (cả 2 chiều)
        const existing = await FriendRequests.findOne({
            $or: [
                { sender: senderId, receiver: receiverId },
                { sender: receiverId, receiver: senderId },
            ],
        });

        if (existing) {
            if (existing.status === FriendRequestStatus.Pending) {
                return res.status(400).send({ status: IResponseStatus.Error, message: "Friend request already sent" });
            }
            if (existing.status === FriendRequestStatus.Accepted) {
                return res.status(400).send({ status: IResponseStatus.Error, message: "You are already friends" });
            }
            // Declined → cho phép gửi lại bằng cách update
            existing.sender = new mongoose.Types.ObjectId(senderId);
            existing.receiver = new mongoose.Types.ObjectId(receiverId);
            existing.status = FriendRequestStatus.Pending;
            await existing.save();

            return res.status(200).send({
                status: IResponseStatus.Success,
                message: "Friend request sent",
                data: existing,
            });
        }

        const request = await FriendRequests.create({
            sender: senderId,
            receiver: receiverId,
        });

        return res.status(201).send({
            status: IResponseStatus.Success,
            message: "Friend request sent",
            data: request,
        });
    } catch (error) {
        console.error("Send friend request error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// PATCH /api/v1/friends/request/:requestId/accept
// Chấp nhận lời mời kết bạn
const acceptFriendRequest: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { requestId } = req.params;

    if (!objectIdRegex.test(requestId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid request ID" });
    }

    try {
        const request = await FriendRequests.findById(requestId);

        if (!request) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Friend request not found" });
        }

        if (request.receiver.toString() !== userId) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You are not allowed to accept this request" });
        }

        if (request.status !== FriendRequestStatus.Pending) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "This request has already been responded to" });
        }

        request.status = FriendRequestStatus.Accepted;
        await request.save();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Friend request accepted",
            data: request,
        });
    } catch (error) {
        console.error("Accept friend request error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// PATCH /api/v1/friends/request/:requestId/decline
// Từ chối lời mời kết bạn
const declineFriendRequest: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { requestId } = req.params;

    if (!objectIdRegex.test(requestId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid request ID" });
    }

    try {
        const request = await FriendRequests.findById(requestId);

        if (!request) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Friend request not found" });
        }

        if (request.receiver.toString() !== userId) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You are not allowed to decline this request" });
        }

        if (request.status !== FriendRequestStatus.Pending) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "This request has already been responded to" });
        }

        request.status = FriendRequestStatus.Declined;
        await request.save();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Friend request declined",
        });
    } catch (error) {
        console.error("Decline friend request error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// DELETE /api/v1/friends/:friendId
// Hủy kết bạn
const removeFriend: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { friendId } = req.params;

    if (!objectIdRegex.test(friendId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid user ID" });
    }

    try {
        const request = await FriendRequests.findOne({
            status: FriendRequestStatus.Accepted,
            $or: [
                { sender: userId, receiver: friendId },
                { sender: friendId, receiver: userId },
            ],
        });

        if (!request) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Friendship not found" });
        }

        await request.deleteOne();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Friend removed successfully",
        });
    } catch (error) {
        console.error("Remove friend error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// DELETE /api/v1/friends/request/:requestId/cancel
// Hủy lời mời đã gửi (người gửi tự hủy)
const cancelFriendRequest: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { requestId } = req.params;

    if (!objectIdRegex.test(requestId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid request ID" });
    }

    try {
        const request = await FriendRequests.findById(requestId);

        if (!request) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "Friend request not found" });
        }

        if (request.sender.toString() !== userId) {
            return res.status(403).send({ status: IResponseStatus.Error, message: "You are not allowed to cancel this request" });
        }

        if (request.status !== FriendRequestStatus.Pending) {
            return res.status(400).send({ status: IResponseStatus.Error, message: "This request has already been responded to" });
        }

        await request.deleteOne();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Friend request cancelled",
        });
    } catch (error) {
        console.error("Cancel friend request error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/friends
// Lấy danh sách bạn bè
const getFriends: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        const requests = await FriendRequests.find({
            status: FriendRequestStatus.Accepted,
            $or: [{ sender: userId }, { receiver: userId }],
        })
            .populate("sender", "-password -refreshToken")
            .populate("receiver", "-password -refreshToken")
            .sort({ updatedAt: -1 });

        const friends = requests.map((r) => {
            const isSender = r.sender._id.toString() === userId;
            return isSender ? r.receiver : r.sender;
        });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Friends retrieved successfully",
            data: friends,
        });
    } catch (error) {
        console.error("Get friends error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/friends/requests/incoming
// Lấy các lời mời kết bạn đang chờ (nhận được)
const getIncomingRequests: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        const requests = await FriendRequests.find({
            receiver: userId,
            status: FriendRequestStatus.Pending,
        })
            .populate("sender", "-password -refreshToken")
            .sort({ createdAt: -1 });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Incoming requests retrieved successfully",
            data: requests,
        });
    } catch (error) {
        console.error("Get incoming requests error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/friends/requests/outgoing
// Lấy các lời mời kết bạn đã gửi đang chờ
const getOutgoingRequests: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        const requests = await FriendRequests.find({
            sender: userId,
            status: FriendRequestStatus.Pending,
        })
            .populate("receiver", "-password -refreshToken")
            .sort({ createdAt: -1 });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Outgoing requests retrieved successfully",
            data: requests,
        });
    } catch (error) {
        console.error("Get outgoing requests error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

// GET /api/v1/friends/status/:targetId
// Kiểm tra trạng thái kết bạn với 1 người cụ thể
const getFriendshipStatus: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { targetId } = req.params;

    if (!objectIdRegex.test(targetId)) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "Invalid user ID" });
    }

    try {
        const request = await FriendRequests.findOne({
            $or: [
                { sender: userId, receiver: targetId },
                { sender: targetId, receiver: userId },
            ],
        });

        if (!request) {
            return res.status(200).send({
                status: IResponseStatus.Success,
                data: { status: "none", requestId: null },
            });
        }

        return res.status(200).send({
            status: IResponseStatus.Success,
            data: {
                status: request.status,
                requestId: request._id,
                isSender: request.sender.toString() === userId,
            },
        });
    } catch (error) {
        console.error("Get friendship status error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred. Please try again later" });
    }
};

export {
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    cancelFriendRequest,
    getFriends,
    getIncomingRequests,
    getOutgoingRequests,
    getFriendshipStatus,
};
