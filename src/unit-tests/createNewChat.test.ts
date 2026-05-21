import { Response } from 'express';
import { Model } from 'mongoose';
import { createNewChat } from '../controllers/createNewChat.js';
import { IChat } from '../models/Chat.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';
import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";

/**
 * Minimal mock of Mongoose Model<IChat> — only implements the methods
 * the controller actually calls (findOne, create).
 */
type MockedChatModel = {
    findOne: jest.Mock;
    create: jest.Mock;
};

const createMockChatModel = (): MockedChatModel & Model<IChat> => {
    return {
        findOne: jest.fn(),
        create: jest.fn(),
    } as unknown as MockedChatModel & Model<IChat>;
};

describe('createNewChat Controller — 6 Critical Edge Cases', () => {
    let mockChatModel: MockedChatModel & Model<IChat>;
    let req: Partial<AuthenticatedRequest>;
    let res: Response;

    beforeEach(() => {
        mockChatModel = createMockChatModel();

        req = {
            user: { _id: 'user-123', name: 'Test User', email: 'test@example.com' } as any,
            body: {},
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        } as unknown as Response;

        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 1: Missing otherUserId
    // ─────────────────────────────────────────────────────────────────────────────
    describe('1. Missing otherUserId', () => {
        it('should return 400 and never touch the database', async () => {
            req.body = {}; // otherUserId omitted

            const handler = createNewChat(mockChatModel);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(res.status).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                message: 'Other userid is required',
            });
            expect(mockChatModel.findOne).not.toHaveBeenCalled();
            expect(mockChatModel.create).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 2: Existing 1-on-1 chat already exists
    // ─────────────────────────────────────────────────────────────────────────────
    describe('2. Existing chat between the two users', () => {
        it('should return 200 with the existing chatId', async () => {
            req.body = { otherUserId: 'other-456' };
            const existingChat = { _id: 'existing-chat-789' } as unknown as IChat;
            (mockChatModel.findOne as jest.Mock<any>).mockResolvedValue(existingChat);

            const handler = createNewChat(mockChatModel);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.findOne).toHaveBeenCalledTimes(1);
            expect(mockChatModel.findOne).toHaveBeenCalledWith({
                users: { $all: ['user-123', 'other-456'], $size: 2 },
            });
            expect(mockChatModel.create).not.toHaveBeenCalled();
            // Express defaults to 200 when res.status() is not explicitly called
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({
                message: 'Chat already exitst',
                chatId: 'existing-chat-789',
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 3: Happy path — new chat created
    // ─────────────────────────────────────────────────────────────────────────────
    describe('3. New chat created successfully', () => {
        it('should return 201 with the new chatId', async () => {
            req.body = { otherUserId: 'other-456' };
            (mockChatModel.findOne as jest.Mock<any>).mockResolvedValue(null);

            const newChat = { _id: 'new-chat-999' } as unknown as IChat;
            (mockChatModel.create as jest.Mock<any>).mockResolvedValue(newChat);

            const handler = createNewChat(mockChatModel);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.findOne).toHaveBeenCalledWith({
                users: { $all: ['user-123', 'other-456'], $size: 2 },
            });
            expect(mockChatModel.create).toHaveBeenCalledTimes(1);
            expect(mockChatModel.create).toHaveBeenCalledWith({
                users: ['user-123', 'other-456'],
            });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                message: 'New Chat created',
                chatId: 'new-chat-999',
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 4: Database failure during findOne
    // ─────────────────────────────────────────────────────────────────────────────
    describe('4. Database error during findOne', () => {
        it('should return 500 via TryCatch wrapper', async () => {
            req.body = { otherUserId: 'other-456' };

            (mockChatModel.findOne as jest.MockedFunction<any>).mockRejectedValue(
                new Error('MongoDB connection lost')
            );

            const handler = createNewChat(mockChatModel);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.findOne).toHaveBeenCalled();
            expect(mockChatModel.create).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                message: 'MongoDB connection lost',
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 5: Database failure during create
    // ─────────────────────────────────────────────────────────────────────────────
    describe('5. Database error during create', () => {
        it('should return 500 via TryCatch wrapper', async () => {
            req.body = { otherUserId: 'other-456' };
            (mockChatModel.findOne as jest.Mock<any>).mockResolvedValue(null);

            (mockChatModel.create as jest.MockedFunction<any>).mockRejectedValue(
                new Error('E11000 duplicate key error')
            );

            const handler = createNewChat(mockChatModel);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.findOne).toHaveBeenCalled();
            expect(mockChatModel.create).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                message: 'E11000 duplicate key error',
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 6: req.user is null/undefined (auth context missing)
    // ─────────────────────────────────────────────────────────────────────────────
    describe('6. Missing req.user (unauthenticated request)', () => {
        it('proceeds without userId validation — documents missing guard', async () => {
            req.user = null as any; // simulates auth middleware not running or failing
            req.body = { otherUserId: 'other-456' };
            (mockChatModel.findOne as jest.Mock<any>).mockResolvedValue(null);

            const newChat = { _id: 'chat-unsafe-000' } as unknown as IChat;
            (mockChatModel.create as jest.Mock<any>).mockResolvedValue(newChat);

            const handler = createNewChat(mockChatModel);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            // This test documents the CURRENT behavior:
            // The controller does NOT validate that req.user exists before using userId.
            // In production this would be caught by isAuth middleware, but the controller
            // itself is not defensive. Consider adding: if (!userId) return 400.
            expect(mockChatModel.findOne).toHaveBeenCalledWith({
                users: { $all: [undefined, 'other-456'], $size: 2 },
            });
            expect(mockChatModel.create).toHaveBeenCalledWith({
                users: [undefined, 'other-456'],
            });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                message: 'New Chat created',
                chatId: 'chat-unsafe-000',
            });
        });
    });
});