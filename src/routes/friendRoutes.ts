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
import { validate } from "../middlewares/validate.js";
import { receiverIdParamSchema, requestIdParamSchema, friendIdParamSchema, targetIdParamSchema } from "../schemas/friend.schema.js";

const friendRouter = express.Router();

friendRouter.use(verifyToken);

// Danh sách bạn bè & requests
friendRouter.get("/", getFriends);
friendRouter.get("/requests/incoming", getIncomingRequests);
friendRouter.get("/requests/outgoing", getOutgoingRequests);
friendRouter.get("/status/:targetId", validate(targetIdParamSchema), getFriendshipStatus);

// Gửi / hủy lời mời
friendRouter.post("/request/:receiverId", validate(receiverIdParamSchema), sendFriendRequest);
friendRouter.delete("/request/:requestId/cancel", validate(requestIdParamSchema), cancelFriendRequest);

// Phản hồi lời mời
friendRouter.patch("/request/:requestId/accept", validate(requestIdParamSchema), acceptFriendRequest);
friendRouter.patch("/request/:requestId/decline", validate(requestIdParamSchema), declineFriendRequest);

// Hủy kết bạn
friendRouter.delete("/:friendId", validate(friendIdParamSchema), removeFriend);

export default friendRouter;
