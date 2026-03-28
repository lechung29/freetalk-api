/** @format */

import express from "express";
import {
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
    getFriends,
    getIncomingRequests,
    getOutgoingRequests,
    getFriendshipStatus,
} from "../controllers/friend/friendController.js";
import { verifyToken } from "../middlewares/auth.js";

const friendRouter = express.Router();

// Tất cả routes đều cần auth
friendRouter.use(verifyToken);

// Danh sách bạn bè & requests
friendRouter.get("/", getFriends);
friendRouter.get("/requests/incoming", getIncomingRequests);
friendRouter.get("/requests/outgoing", getOutgoingRequests);
friendRouter.get("/status/:targetId", getFriendshipStatus);

// Gửi / hủy lời mời
friendRouter.post("/request/:receiverId", sendFriendRequest);
friendRouter.delete("/request/:requestId/cancel", cancelFriendRequest);

// Phản hồi lời mời
friendRouter.patch("/request/:requestId/accept", acceptFriendRequest);
friendRouter.patch("/request/:requestId/decline", declineFriendRequest);

// Hủy kết bạn
friendRouter.delete("/:friendId", removeFriend);

export default friendRouter;
