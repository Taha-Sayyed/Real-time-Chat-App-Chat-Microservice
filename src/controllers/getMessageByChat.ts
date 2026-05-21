import TryCatch from "../config/TryCatch.js";
import { AuthenticatedRequest } from "../middlewares/auth.js";
import { IChat } from "../models/Chat.js";
import { IMessage } from "../models/Messages.js";
import { Model } from "mongoose";
import { ISocketService } from "./sendMessage.js";

type FetchUser = (userId: string) => Promise<any>;

export const getMessageByChat = (
    chatModel: Model<IChat>,
    messagesModel: Model<IMessage>,
    fetchUser: FetchUser,
    socketService: ISocketService
) =>
    TryCatch(async (req: AuthenticatedRequest, res) => {
        const userId = req.user?._id;
        const { chatId } = req.params;

        if (!userId) {
            res.status(401).json({
                message: "Unauthorized",
            });
            return;
        }

        if (!chatId) {
            res.status(400).json({
                message: "ChatId Required",
            });
            return;
        }

        const chat = await chatModel.findById(chatId);

        if (!chat) {
            res.status(404).json({
                message: "Chat not found",
            });
            return;
        }

        const isUserInChat = chat.users.some(
            (id) => id.toString() === userId.toString()
        );

        if (!isUserInChat) {
            res.status(403).json({
                message: "You are not a participant of this chat",
            });
            return;
        }

        const messagesToMarkSeen = await messagesModel.find({
            chatId: chatId,
            sender: { $ne: userId },
            seen: false,
        });

        await messagesModel.updateMany(
            {
                chatId: chatId,
                sender: { $ne: userId },
                seen: false,
            },
            {
                seen: true,
                seenAt: new Date(),
            }
        );

        const messages = await messagesModel.find({ chatId }).sort({ createdAt: 1 });

        const otherUserId = chat.users.find((id) => id !== userId);

        try {
            if (!otherUserId) {
                res.status(400).json({
                    message: "No other user",
                });
                return;
            }

            const data = await fetchUser(otherUserId.toString());

            if (messagesToMarkSeen.length > 0) {
                socketService.emitToUser(otherUserId.toString(), "messagesSeen", {
                    chatId: chatId,
                    seenBy: userId,
                    messageIds: messagesToMarkSeen.map((msg) => msg._id),
                });
            }

            res.json({
                messages,
                user: data,
            });
        } catch (error) {
            console.log(error);
            res.json({
                messages,
                user: { _id: otherUserId, name: "Unknown User" },
            });
        }
    });