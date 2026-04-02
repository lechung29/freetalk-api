/** @format */

import type { Response, RequestHandler } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth";
import Notifications from "../../models/notifications/notificationModel";
import { IResponseStatus } from "../../models/users/usersModel";
import { convertToUserTimezone } from "../../utils/timezoneConverter";

const getNotifications: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const timezone = req.user?.timezone ?? "";

    try {
        const notifications = await Notifications.find({ recipient: userId }).sort({ createdAt: -1 }).limit(50).lean();

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Notifications retrieved successfully",
            data: notifications.map((n) => ({
                id: n._id.toString(),
                type: n.type,
                title: n.title,
                body: n.body,
                data: n.data,
                isRead: n.isRead,
                createdAt: convertToUserTimezone(n.createdAt, timezone),
            })),
        });
    } catch (error) {
        console.error("Get notifications error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const markAsRead: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;

    try {
        await Notifications.findOneAndUpdate({ _id: id, recipient: userId }, { isRead: true });

        return res.status(200).send({ status: IResponseStatus.Success, message: "Marked as read" });
    } catch (error) {
        console.error("Mark as read error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const markAllAsRead: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        await Notifications.updateMany({ recipient: userId, isRead: false }, { isRead: true });

        return res.status(200).send({ status: IResponseStatus.Success, message: "All marked as read" });
    } catch (error) {
        console.error("Mark all as read error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const deleteNotification: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;

    try {
        await Notifications.findOneAndDelete({ _id: id, recipient: userId });

        return res.status(200).send({ status: IResponseStatus.Success, message: "Notification deleted" });
    } catch (error) {
        console.error("Delete notification error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const clearAllNotifications: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
        await Notifications.deleteMany({ recipient: userId });

        return res.status(200).send({ status: IResponseStatus.Success, message: "All notifications cleared" });
    } catch (error) {
        console.error("Clear notifications error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

export { getNotifications, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications };
