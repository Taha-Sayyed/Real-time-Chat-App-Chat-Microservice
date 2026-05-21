import TryCatch from "../config/TryCatch.js";
import { AuthenticatedRequest } from "../middlewares/auth.js";
import { IChat } from "../models/Chat.js";
import { IMessage } from "../models/Messages.js";
import { Model } from "mongoose";

export interface ISocketService {
    emitToRoom(roomId: string, event: string, data: any): void;
    emitToUser(userId: string, event: string, data: any): void;
    isUserInRoom(userId: string, roomId: string): boolean;
}

export const sendMessage = (
    chatModel: Model<IChat>,
    messagesModel: Model<IMessage>,
    socketService: ISocketService
) =>
    TryCatch(async (req: AuthenticatedRequest, res) => {
        const senderId = req.user?._id;
        const { chatId, text } = req.body;
        const imageFile = req.file;

        if (!senderId) {
            res.status(401).json({
                message: "unauthorized",
            });
            return;
        }

        if (!chatId) {
            res.status(400).json({
                message: "ChatId Required",
            });
            return;
        }

        if (!text && !imageFile) {
            res.status(400).json({
                message: "Either text or image is required",
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
            (userId) => userId.toString() === senderId.toString()
        );

        if (!isUserInChat) {
            res.status(403).json({
                message: "You are not a participant of this chat",
            });
            return;
        }

        const otherUserId = chat.users.find(
            (userId) => userId.toString() !== senderId.toString()
        );

        if (!otherUserId) {
            res.status(401).json({
                message: "No other user",
            });
            return;
        }

        const isReceiverInChatRoom = socketService.isUserInRoom(
            otherUserId.toString(),
            chatId
        );

        let messageData: any = {
            chatId: chatId,
            sender: senderId,
            seen: isReceiverInChatRoom,
            seenAt: isReceiverInChatRoom ? new Date() : undefined,
        };

        if (imageFile) {
            messageData.image = {
                url: imageFile.path,
                publicId: imageFile.filename,
            };
            messageData.messageType = "image";
            messageData.text = text || "";
        } else {
            messageData.text = text;
            messageData.messageType = "text";
        }

        const message = new messagesModel(messageData);
        const savedMessage = await message.save();

        const latestMessageText = imageFile ? "📷 Image" : text;

        await chatModel.findByIdAndUpdate(
            chatId,
            {
                latestMessage: {
                    text: latestMessageText,
                    sender: senderId,
                },
                updatedAt: new Date(),
            },
            { new: true }
        );

        socketService.emitToRoom(chatId, "newMessage", savedMessage);
        socketService.emitToUser(otherUserId.toString(), "newMessage", savedMessage);
        socketService.emitToUser(senderId.toString(), "newMessage", savedMessage);

        if (isReceiverInChatRoom) {
            socketService.emitToUser(senderId.toString(), "messagesSeen", {
                chatId: chatId,
                seenBy: otherUserId,
                messageIds: [savedMessage._id],
            });
        }

        res.status(201).json({
            message: savedMessage,
            sender: senderId,
        });
    });