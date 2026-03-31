/** @format */

import express from "express";
import { getNotifications, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications } from "../controllers/notification/notificationController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { notificationIdParamSchema } from "../schemas/notification.schema.js";

const notificationRouter = express.Router();

notificationRouter.use(verifyToken);

notificationRouter.get("/", getNotifications);
notificationRouter.patch("/read-all", markAllAsRead);
notificationRouter.patch("/:id/read", validate(notificationIdParamSchema), markAsRead);
notificationRouter.delete("/", clearAllNotifications);
notificationRouter.delete("/:id", validate(notificationIdParamSchema), deleteNotification);

export default notificationRouter;
