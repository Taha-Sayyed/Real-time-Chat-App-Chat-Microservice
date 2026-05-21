import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";
import { Types, Model } from "mongoose";
import { Response } from "express";
import { sendMessage, ISocketService } from "../controllers/sendMessage.js";
import { AuthenticatedRequest } from "../middlewares/auth.js";
import { IChat } from "../models/Chat.js";
import { IMessage } from "../models/Messages.js";

describe("sendMessage controller", () => {
    let mockChatModel: jest.Mocked<Model<IChat>>;
    let mockMessagesModel: jest.Mocked<Model<IMessage>>;
    let mockSave: jest.MockedFunction<() => Promise<IMessage>>;
    let mockSocketService: jest.Mocked<ISocketService>;
    let req: Partial<AuthenticatedRequest>;
    let res: Partial<Response>;
    let handler: ReturnType<typeof sendMessage>;

    beforeEach(() => {
        jest.clearAllMocks();

        // --- Mock Chat Model ---
        mockChatModel = {
            findById: jest.fn(),
            findByIdAndUpdate: jest
                .fn<() => Promise<IChat | null>>()
                .mockResolvedValue({} as IChat),
        } as unknown as jest.Mocked<Model<IChat>>;

        // --- Mock Messages Model (constructor + instance.save) ---
        mockSave = jest.fn();
        const MockConstructor = jest.fn().mockImplementation((data: any) => ({
            ...data,
            _id: new Types.ObjectId(),
            save: mockSave,
        }));
        mockMessagesModel = MockConstructor as unknown as jest.Mocked<Model<IMessage>>;

        // --- Mock Socket Service ---
        mockSocketService = {
            emitToRoom: jest.fn(),
            emitToUser: jest.fn(),
            isUserInRoom: jest.fn(),
        };

        // Build the wrapped handler
        handler = sendMessage(mockChatModel, mockMessagesModel, mockSocketService);

        // --- Default request / response ---
        req = {
            user: { _id: "user1", name: "Test User", email: "test@test.com" } as any,
            body: {},
            file: undefined,
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        } as any;
    });

    // 1. Unauthorized: req.user is missing
    it("returns 401 when the request is not authenticated", async () => {
        req.user = undefined;
        req.body = { chatId: new Types.ObjectId().toString(), text: "hello" };

        await handler(req as AuthenticatedRequest, res as Response, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: "unauthorized" });
    });

    // 2. Bad Request: chatId is missing
    it("returns 400 when chatId is not provided", async () => {
        req.body = { text: "hello" };

        await handler(req as AuthenticatedRequest, res as Response, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: "ChatId Required" });
    });

    // 3. Bad Request: both text and image are missing
    it("returns 400 when both text and image are missing", async () => {
        req.body = { chatId: new Types.ObjectId().toString() };
        req.file = undefined;

        await handler(req as AuthenticatedRequest, res as Response, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            message: "Either text or image is required",
        });
    });

    // 4. Not Found: chat does not exist
    it("returns 404 when the chat is not found", async () => {
        const chatId = new Types.ObjectId().toString();
        req.body = { chatId, text: "hello" };
        mockChatModel.findById.mockResolvedValue(null);

        await handler(req as AuthenticatedRequest, res as Response, jest.fn());

        expect(mockChatModel.findById).toHaveBeenCalledWith(chatId);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ message: "Chat not found" });
    });

    // 5. Forbidden: sender is not a participant
    it("returns 403 when sender is not a participant of the chat", async () => {
        const chatId = new Types.ObjectId().toString();
        req.body = { chatId, text: "hello" };
        req.user = { _id: "user1", name: "User", email: "u1@test.com" } as any;

        mockChatModel.findById.mockResolvedValue({
            _id: chatId,
            users: ["user2", "user3"],
        } as unknown as IChat);

        await handler(req as AuthenticatedRequest, res as Response, jest.fn());

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            message: "You are not a participant of this chat",
        });
    });

    // 6. Success: text message, receiver NOT in room (offline)
    it("sends a text message and keeps seen=false when receiver is not in the room", async () => {
        const chatId = new Types.ObjectId().toString();
        const messageId = new Types.ObjectId();
        const senderId = "user1";
        const receiverId = "user2";

        req.body = { chatId, text: "hello world" };
        req.user = { _id: senderId, name: "User1", email: "u1@test.com" } as any;

        mockChatModel.findById.mockResolvedValue({
            _id: chatId,
            users: [senderId, receiverId],
        } as unknown as IChat);

        mockSocketService.isUserInRoom.mockReturnValue(false);

        const savedMessage = {
            _id: messageId,
            chatId,
            sender: senderId,
            text: "hello world",
            messageType: "text",
            seen: false,
        };

        mockSave.mockResolvedValue(savedMessage as unknown as IMessage);
        await handler(req as AuthenticatedRequest, res as Response, jest.fn());

        // Message construction
        expect(mockMessagesModel).toHaveBeenCalledTimes(1);
        expect(mockMessagesModel).toHaveBeenCalledWith(
            expect.objectContaining({
                chatId,
                sender: senderId,
                text: "hello world",
                messageType: "text",
                seen: false,
                seenAt: undefined,
            })
        );
        expect(mockSave).toHaveBeenCalledTimes(1);

        // Chat side-effect
        expect(mockChatModel.findByIdAndUpdate).toHaveBeenCalledWith(
            chatId,
            {
                latestMessage: {
                    text: "hello world",
                    sender: senderId,
                },
                updatedAt: expect.any(Date),
            },
            { new: true }
        );

        // Socket emissions
        expect(mockSocketService.emitToRoom).toHaveBeenCalledWith(
            chatId,
            "newMessage",
            savedMessage
        );
        expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
            receiverId,
            "newMessage",
            savedMessage
        );
        expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
            senderId,
            "newMessage",
            savedMessage
        );

        // messagesSeen must NOT fire when receiver is offline
        const seenCalls = mockSocketService.emitToUser.mock.calls.filter(
            ([, eventName]) => eventName === "messagesSeen"
        );
        expect(seenCalls).toHaveLength(0);

        // Response
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            message: savedMessage,
            sender: senderId,
        });
    });
});