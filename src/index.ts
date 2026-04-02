/** @format */

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { setIO } from "./socket/socketInstance";
import { connectDB } from "./config/database";
import groupRouter from "./routes/groupRoutes";
import authRouter from "./routes/authRoutes";
import userRouter from "./routes/userRoutes";
import friendRouter from "./routes/friendRoutes";
import conversationRouter from "./routes/conversationRoutes";
import notificationRouter from "./routes/notificationRoutes";
import { initSocket } from "./socket/socketHandler";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
    cors: {
        origin: ["http://localhost:5173"],
        credentials: true,
    },
    maxHttpBufferSize: 50 * 1024 * 1024,
});

setIO(io);

app.use(express.json());
app.use(
    cors({
        origin: ["http://localhost:5173", "https://craft-ui-phi.vercel.app"],
        credentials: true,
    }),
);
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const port = process.env.SERVER_PORT || 5000;
connectDB();

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/friends", friendRouter);
app.use("/api/v1/conversations", conversationRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/groups", groupRouter);

app.get("/health", (_req, res) => {
    res.status(200).send("OK");
});

initSocket(io);

httpServer.listen(port, () => {
    console.log(`Server running on port:${port}`);
});
