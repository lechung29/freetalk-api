/** @format */

import express from "express";
import {
    getOrCreateConversation,
    getConversations,
    getMessages,
    markAsRead,
} from "../controllers/conversation/conversationController.js";
import { verifyToken } from "../middlewares/auth.js";

const conversationRouter = express.Router();

conversationRouter.use(verifyToken);

conversationRouter.get("/", getConversations);
conversationRouter.post("/", getOrCreateConversation);
conversationRouter.get("/:conversationId/messages", getMessages);
conversationRouter.patch("/:conversationId/read", markAsRead);

export default conversationRouter;
