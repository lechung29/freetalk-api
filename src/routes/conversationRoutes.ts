/** @format */

import express from "express";
import {
    getOrCreateConversation,
    getConversations,
    getMessages,
    markAsRead,
    getPinnedMessages,
    searchMessages,
    getOrCreateGroupConversation,
    updateNickname,
    getMediaMessages,
} from "../controllers/conversation/conversationController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { conversationIdParamSchema, getMessagesSchema, getOrCreateConversationSchema, searchMessagesSchema } from "../schemas/conversation.schema.js";

const conversationRouter = express.Router();

conversationRouter.use(verifyToken);

conversationRouter.get("/", getConversations);
conversationRouter.post("/", validate(getOrCreateConversationSchema), getOrCreateConversation);
conversationRouter.get("/:conversationId/messages", validate(getMessagesSchema), getMessages);
conversationRouter.patch("/:conversationId/read", validate(conversationIdParamSchema), markAsRead);
conversationRouter.get("/:conversationId/pinned", validate(conversationIdParamSchema), getPinnedMessages);
conversationRouter.get("/:conversationId/search", validate(searchMessagesSchema), searchMessages);

conversationRouter.post("/group/:groupId", getOrCreateGroupConversation);
conversationRouter.patch("/:conversationId/nickname", updateNickname);
conversationRouter.get("/:conversationId/media", validate(conversationIdParamSchema), getMediaMessages);

export default conversationRouter;
