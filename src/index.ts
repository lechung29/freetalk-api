/** @format */

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { connectDB } from "./config/database.js";
import authRouter from "./routes/authRoutes.js";
import userRouter from "./routes/userRoutes.js";
import friendRouter from "./routes/friendRoutes.js";
import conversationRouter from "./routes/conversationRoutes.js";
import { initSocket } from "./socket/socketHandler.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
    cors: {
        origin: ["http://localhost:5173", "https://craft-ui-phi.vercel.app"],
        credentials: true,
    },
});

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

// ── Routes ──
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/friends", friendRouter);
app.use("/api/v1/conversations", conversationRouter);

app.get("/health", (_req, res) => {
    res.status(200).send("OK");
});

// ── Socket.io ──
initSocket(io);

httpServer.listen(port, () => {
    console.log(`Server running on port:${port}`);
});