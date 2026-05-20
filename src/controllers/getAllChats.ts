import TryCatch from "../config/TryCatch.js";
import { AuthenticatedRequest } from "../middlewares/auth.js";
import { IChat } from "../models/Chat.js";
import { IMessage } from "../models/Messages.js";
import { Model } from "mongoose";

type FetchUser = (userId: string) => Promise<any>;

export const getAllChats = (
    chatModel: Model<IChat>,
    messagesModel: Model<IMessage>,
    fetchUser: FetchUser
) => TryCatch(async (req: AuthenticatedRequest, res) => {
    const userId = req.user?._id;

    if (!userId) {
        res.status(400).json({
            message: " UserId missing",
        });
        return;
    }

    const chats = await chatModel.find({ users: userId }).sort({ updatedAt: -1 });

    const chatWithUserData = await Promise.all(
        chats.map(async (chat) => {
            const otherUserId = chat.users.find((id) => id !== userId);

            const unseenCount = await messagesModel.countDocuments({
                chatId: chat._id,
                sender: { $ne: userId },
                seen: false,
            });

            try {
                const data = await fetchUser(otherUserId as string);

                return {
                    user: data,
                    chat: {
                        ...chat.toObject(),
                        latestMessage: chat.latestMessage || null,
                        unseenCount,
                    },
                };
            } catch (error) {
                console.log(error);
                return {
                    user: { _id: otherUserId, name: "Unknown User" },
                    chat: {
                        ...chat.toObject(),
                        latestMessage: chat.latestMessage || null,
                        unseenCount,
                    },
                };
            }
        })
    )

    res.json({
        chats: chatWithUserData,
    });
});


