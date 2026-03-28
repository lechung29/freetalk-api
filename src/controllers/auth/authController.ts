/** @format */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import bcryptjs from "bcryptjs";
import Users, { IResponseStatus, IUserStatus, type IUserData } from "../../models/users/usersModel.js";
import type { AuthenticatedRequest } from "../../middlewares/auth.js";

const loginWithGoogle: RequestHandler = async (req: Request, res: Response) => {
    const { email, username, avatar } = req.body;

    try {
        let existingUser = await Users.findOne({ email });

        if (existingUser && existingUser.status === IUserStatus.Deleted) {
            return res.status(403).send({
                status: IResponseStatus.Error,
                message: "The email address you entered is not associated with any account. Please check your email or register if you don't have an account",
            });
        }

        if (!existingUser) {
            const newUser = new Users({
                username,
                email,
                avatar,
                password: bcryptjs.hashSync(Math.random().toString(36), 10),
            });

            await newUser.save();
            existingUser = newUser;
        }

        const accessToken = await jwt.sign({ id: existingUser.id, username: existingUser.username }, process.env.JWT_SECRET!, { expiresIn: "10m" });
        const currentRefreshToken = jwt.sign({ id: existingUser.id, email: existingUser.email, username: existingUser.username }, process.env.JWT_SECRET!, { expiresIn: "1y" });

        await existingUser.updateOne({ $push: { refreshToken: currentRefreshToken } });

        const { password, refreshToken, ...rest } = existingUser.toObject();

        return res
            .status(200)
            .cookie("refreshToken", currentRefreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: "none",
            })
            .send({
                status: IResponseStatus.Success,
                message: "Welcome! You have successfully logged into your account",
                data: {
                    ...rest,
                    accessToken,
                },
            });
    } catch (error: any) {
        console.error("Google login error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

const logoutUser: RequestHandler = async (req: Request, res: Response) => {
    try {
        const refreshToken = req.cookies?.refreshToken;

        if (refreshToken) {
            const user = await Users.findOne({ refreshToken: refreshToken });
            if (user) {
                user.refreshToken = user.refreshToken.filter((token) => token !== refreshToken);
                await user.save();
            }
        }

        res.clearCookie("refreshToken", {
            httpOnly: true,
            secure: true,
            sameSite: "none",
        });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Logout successfully",
        });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).send({
            status: IResponseStatus.Error,
            message: "A system error occurred. Please try again later",
        });
    }
};

//#region Refresh Token

const refreshToken: RequestHandler = async (req: Request, res: Response, _next: NextFunction) => {
    const cookieRefreshToken = req.cookies?.refreshToken;

    if (!cookieRefreshToken) {
        return res.status(200).send({
            status: IResponseStatus.Error,
            message: "Your session has expired. Please log in again",
        });
    }

    try {
        const decoded = jwt.verify(cookieRefreshToken, process.env.JWT_SECRET!) as any;

        if (!decoded || !decoded.id) {
            return res.status(200).send({
                status: IResponseStatus.Error,
                message: "Invalid session token. Please log in again",
            });
        }

        const user = await Users.findById(decoded.id);

        if (!user) {
            return res.status(200).send({
                status: IResponseStatus.Error,
                message: "User not found. Please log in again",
            });
        }

        if (!user.refreshToken.includes(cookieRefreshToken)) {
            return res.status(200).send({
                status: IResponseStatus.Error,
                message: "Your session has expired. Please log in again",
            });
        }

        const newAccessToken = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET!, { expiresIn: "10m" });

        return res.status(200).send({
            status: IResponseStatus.Success,
            message: "Access token refreshed successfully",
            data: {
                accessToken: newAccessToken,
            },
        });
    } catch (error: any) {
        console.error("Refresh token error:", error);
        return res.status(401).send({
            status: IResponseStatus.Error,
            message: "Your session has expired. Please log in again",
        });
    }
};

const verifyAccessToken: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    return res.status(200).send({
        status: IResponseStatus.Success,
        message: "Token is valid",
    });
};

export { refreshToken, logoutUser, loginWithGoogle, verifyAccessToken };
