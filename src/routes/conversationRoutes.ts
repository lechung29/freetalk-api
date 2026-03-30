/** @format */

import express from "express";
import { getOrCreateConversation, getConversations, getMessages, markAsRead, getPinnedMessages, searchMessages } from "../controllers/conversation/conversationController.js";
import { verifyToken } from "../middlewares/auth.js";

const conversationRouter = express.Router();

conversationRouter.use(verifyToken);

conversationRouter.get("/", getConversations);
conversationRouter.post("/", getOrCreateConversation);
conversationRouter.get("/:conversationId/messages", getMessages);
conversationRouter.patch("/:conversationId/read", markAsRead);
conversationRouter.get("/:conversationId/pinned", getPinnedMessages);
conversationRouter.get("/:conversationId/search", searchMessages);

export default conversationRouter;
