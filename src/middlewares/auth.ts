/** @format */

import jwt from "jsonwebtoken";
import { IResponseStatus, type IUserInfo } from "../models/users/usersModel.js";
import type { NextFunction, Request, Response } from "express";

export interface AuthenticatedRequest extends Request {
    user?: IUserInfo;
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
        req.user = payload as IUserInfo;
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

