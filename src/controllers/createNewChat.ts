import { Model } from "mongoose";
import TryCatch from "../config/TryCatch.js";
import { AuthenticatedRequest } from "../middlewares/auth.js";
import { Chat, IChat } from "../models/Chat.js";

export const createNewChat = (chatModel: Model<IChat>) => TryCatch(async (req: AuthenticatedRequest, res) => {

    const userId = req.user?._id;
    const { otherUserId } = req.body;

    if (!otherUserId) {
        res.status(400).json({
            message: "Other userid is required",
        });
        return;
    }

    const existingChat = await chatModel.findOne({
        users: { $all: [userId, otherUserId], $size: 2 },
    });

    if (existingChat) {
        res.json({
            message: "Chat already exitst",
            chatId: existingChat._id,
        });
        return;
    }

    const newChat = await chatModel.create({
        users: [userId, otherUserId],
    });

    res.status(201).json({
        message: "New Chat created",
        chatId: newChat._id,
    });


})