/** @format */

import express from "express";
import { verifyToken } from "../middlewares/auth";
import { acceptFriendRequest, cancelFriendRequest, declineFriendRequest, getFriends, getFriendshipStatus, getIncomingRequests, getOutgoingRequests, removeFriend, sendFriendRequest } from "../controllers/friend/friendController";
import { validate } from "../middlewares/validate";
import { friendIdParamSchema, receiverIdParamSchema, requestIdParamSchema, targetIdParamSchema } from "../schemas/friend.schema";


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
