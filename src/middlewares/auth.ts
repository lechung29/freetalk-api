/** @format */

import jwt from "jsonwebtoken";
import { IResponseStatus, type IUserInfo } from "../models/users/usersModel.js";
import type { NextFunction, Request, Response } from "express";
import Users from "../models/users/usersModel.js";

export interface AuthenticatedRequest extends Request {
    user?: IUserInfo & { timezone?: string };
}

export const verifyToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const token = req.headers["x-token"] as string;
        if (!token) {
            return res.status(200).send({
                code: 401,
                status: IResponseStatus.Error,
                message: "Session has expired",
                errorMessage: "No token valid",
            });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET!);
        const userInfo = payload as IUserInfo;

        const user = await Users.findById(userInfo.id).select("timezone").lean();
        if (user) {
            userInfo.timezone = user.timezone;
        }

        req.user = userInfo;
        next();
    } catch (error: any) {
        if (error.name === "TokenExpiredError") {
            return res.status(200).send({
                code: 401,
                status: IResponseStatus.Error,
                message: "Session has expired",
                errorMessage: "Token expired",
            });
        }
        return res.status(200).send({
            code: 401,
            status: IResponseStatus.Error,
            message: "Session has expired",
            errorMessage: "Invalid token",
        });
    }
};

