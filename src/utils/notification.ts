/** @format */

import Notifications, { type NotificationType } from "../models/notifications/NotificationModel.js";
import { emitToUser } from "../socket/socketInstance.js";

// Helper: lưu notification vào DB, sau đó emit socket real-time.
// Nếu user offline → chỉ lưu DB, khi online lại sẽ fetch.

interface NotificationPayload {
    recipientId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
}

export async function saveAndEmitNotification(payload: NotificationPayload): Promise<void> {
    const { recipientId, type, title, body, data = {} } = payload;

    try {
        const notification = await Notifications.create({
            recipient: recipientId,
            type,
            title,
            body,
            data,
        });

        emitToUser(recipientId, "notification:new", {
            id: notification._id.toString(),
            type: notification.type,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            isRead: notification.isRead,
            createdAt: notification.createdAt.toISOString(),
        });
    } catch (err) {
        console.error("saveAndEmitNotification error:", err);
    }
}
