/** @format */

import type { Response, RequestHandler } from "express";
import Users, { IResponseStatus } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";
import { emitToUser } from "../../socket/socketInstance.js";

const blockUser: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { targetId } = req.params;

    if (userId === targetId) {
        return res.status(400).send({ status: IResponseStatus.Error, message: "You cannot block yourself" });
    }

    try {
        const user = await Users.findById(userId);
        if (!user) {
            return res.status(404).send({ status: IResponseStatus.Error, message: "User not found" });
        }

        const alreadyBlocked = user.blockedUsers.some((id) => id.toString() === targetId);
        if (alreadyBlocked) {
            return res.status(200).send({ status: IResponseStatus.Success, message: "User already blocked" });
        }

        await Users.findByIdAndUpdate(userId, { $addToSet: { blockedUsers: targetId } });

        emitToUser(targetId!, "user:blocked", { blockedBy: userId });

        return res.status(200).send({ status: IResponseStatus.Success, message: "User blocked successfully" });
    } catch (error) {
        console.error("Block user error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const unblockUser: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { targetId } = req.params;

    try {
        await Users.findByIdAndUpdate(userId, { $pull: { blockedUsers: targetId } });

        emitToUser(targetId!, "user:unblocked", { unblockedBy: userId });

        return res.status(200).send({ status: IResponseStatus.Success, message: "User unblocked successfully" });
    } catch (error) {
        console.error("Unblock user error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

const getBlockStatus: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    const { targetId } = req.params;

    try {
        const [me, them] = await Promise.all([Users.findById(userId).select("blockedUsers").lean(), Users.findById(targetId).select("blockedUsers").lean()]);

        const iBlockedThem = me?.blockedUsers?.some((id) => id.toString() === targetId) ?? false;
        const theyBlockedMe = them?.blockedUsers?.some((id) => id.toString() === userId) ?? false;

        return res.status(200).send({
            status: IResponseStatus.Success,
            data: { iBlockedThem, theyBlockedMe },
        });
    } catch (error) {
        console.error("Get block status error:", error);
        return res.status(500).send({ status: IResponseStatus.Error, message: "A system error occurred" });
    }
};

export { blockUser, unblockUser, getBlockStatus };
