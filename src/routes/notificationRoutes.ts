/** @format */

import express from "express";
import { getNotifications, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications } from "../controllers/notification/notificationController.js";
import { verifyToken } from "../middlewares/auth.js";

const notificationRouter = express.Router();

// Tất cả routes đều cần auth
notificationRouter.use(verifyToken);

notificationRouter.get("/", getNotifications);
notificationRouter.patch("/read-all", markAllAsRead);
notificationRouter.patch("/:id/read", markAsRead);
notificationRouter.delete("/", clearAllNotifications);
notificationRouter.delete("/:id", deleteNotification);

export default notificationRouter;
