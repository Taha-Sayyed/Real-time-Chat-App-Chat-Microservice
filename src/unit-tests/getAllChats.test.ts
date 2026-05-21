import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";
import { Response } from 'express';
import { Model, Types } from 'mongoose';
import { getAllChats } from '../controllers/getAllChats.js';
import { IChat } from '../models/Chat.js';
import { IMessage } from '../models/Messages.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Explicit Mock Interfaces (solves TypeScript inference issues)
// ─────────────────────────────────────────────────────────────────────────────

interface MockChatModel {
    find: jest.Mock;
}

interface MockMessagesModel {
    countDocuments: jest.Mock;
}

interface MockChat extends IChat {
    toObject: jest.Mock;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Factories
// ─────────────────────────────────────────────────────────────────────────────

const createMockChatModel = (): MockChatModel & Model<IChat> => {
    return {
        find: jest.fn(),
    } as unknown as MockChatModel & Model<IChat>;
};

const createMockMessagesModel = (): MockMessagesModel & Model<IMessage> => {
    return {
        countDocuments: jest.fn(),
    } as unknown as MockMessagesModel & Model<IMessage>;
};

const createMockChat = (overrides: Partial<MockChat> = {}): MockChat => {
    const baseId = new Types.ObjectId();
    const baseObject = {
        _id: baseId,
        users: ['user-123', 'other-456'],
        latestMessage: { text: 'Hello', sender: 'other-456' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
    };

    return {
        ...baseObject,
        toObject: jest.fn().mockReturnValue(baseObject),
        ...overrides,
    } as unknown as MockChat;
};

describe('getAllChats Controller — 6 Critical Edge Cases', () => {
    let mockChatModel: MockChatModel & Model<IChat>;
    let mockMessagesModel: MockMessagesModel & Model<IMessage>;
    let mockFetchUser: jest.Mock<any>;
    let req: Partial<AuthenticatedRequest>;
    let res: Response;

    beforeEach(() => {
        mockChatModel = createMockChatModel();
        mockMessagesModel = createMockMessagesModel();
        mockFetchUser = jest.fn();

        req = {
            user: { _id: 'user-123', name: 'Test User', email: 'test@example.com' } as any,
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
    // Edge Case 1: Missing userId (req.user is null)
    // ─────────────────────────────────────────────────────────────────────────────
    describe('1. Missing userId — req.user is null', () => {
        it('should return 400 and never query the database', async () => {
            req.user = null;

            const handler = getAllChats(mockChatModel, mockMessagesModel, mockFetchUser);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(res.status).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: ' UserId missing' });
            expect(mockChatModel.find).not.toHaveBeenCalled();
            expect(mockMessagesModel.countDocuments).not.toHaveBeenCalled();
            expect(mockFetchUser).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 2: No chats found for the user
    // ─────────────────────────────────────────────────────────────────────────────
    describe('2. No chats exist for the user', () => {
        it('should return empty chats array', async () => {
            (mockChatModel.find as jest.Mock).mockReturnValue({
                sort: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
            });

            const handler = getAllChats(mockChatModel, mockMessagesModel, mockFetchUser);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.find).toHaveBeenCalledWith({ users: 'user-123' });
            expect(mockMessagesModel.countDocuments).not.toHaveBeenCalled();
            expect(mockFetchUser).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({ chats: [] });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 3: Happy path — multiple chats, fetchUser succeeds
    // ─────────────────────────────────────────────────────────────────────────────
    describe('3. Multiple chats with successful user fetch', () => {
        it('should return enriched chats with user data and unseen counts', async () => {
            const chat1 = createMockChat({ users: ['user-123', 'other-456'] });
            const chat2 = createMockChat({ users: ['user-123', 'other-789'] });

            (mockChatModel.find as jest.Mock).mockReturnValue({
                sort: jest.fn<() => Promise<any[]>>()
                    .mockResolvedValue([chat1, chat2]),
            });

            (mockMessagesModel.countDocuments as jest.MockedFunction<any>)
                .mockResolvedValueOnce(3)
                .mockResolvedValueOnce(0);

            mockFetchUser
                .mockResolvedValueOnce({ _id: 'other-456', name: 'Alice' })
                .mockResolvedValueOnce({ _id: 'other-789', name: 'Bob' });

            const handler = getAllChats(mockChatModel, mockMessagesModel, mockFetchUser);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.find).toHaveBeenCalledWith({ users: 'user-123' });
            expect(mockMessagesModel.countDocuments).toHaveBeenCalledTimes(2);
            expect(mockMessagesModel.countDocuments).toHaveBeenNthCalledWith(1, {
                chatId: chat1._id,
                sender: { $ne: 'user-123' },
                seen: false,
            });
            expect(mockMessagesModel.countDocuments).toHaveBeenNthCalledWith(2, {
                chatId: chat2._id,
                sender: { $ne: 'user-123' },
                seen: false,
            });
            expect(mockFetchUser).toHaveBeenCalledTimes(2);
            expect(mockFetchUser).toHaveBeenNthCalledWith(1, 'other-456');
            expect(mockFetchUser).toHaveBeenNthCalledWith(2, 'other-789');

            const responseData = (res.json as jest.Mock).mock.calls[0][0] as any;
            expect(responseData.chats).toHaveLength(2);
            expect(responseData.chats[0].user).toEqual({ _id: 'other-456', name: 'Alice' });
            expect(responseData.chats[0].chat.unseenCount).toBe(3);
            expect(responseData.chats[1].user).toEqual({ _id: 'other-789', name: 'Bob' });
            expect(responseData.chats[1].chat.unseenCount).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 4: fetchUser fails for one chat — fallback to "Unknown User"
    // ─────────────────────────────────────────────────────────────────────────────
    describe('4. fetchUser throws error for one chat', () => {
        it('should fallback to Unknown User for that chat and still return others', async () => {
            const chat1 = createMockChat({ users: ['user-123', 'other-456'] });
            const chat2 = createMockChat({ users: ['user-123', 'other-789'] });

            (mockChatModel.find as jest.Mock).mockReturnValue({
                sort: jest.fn<() => Promise<any[]>>()
                    .mockResolvedValue([chat1, chat2]),
            });


            (mockMessagesModel.countDocuments as jest.MockedFunction<any>)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(5);

            mockFetchUser
                .mockRejectedValueOnce(new Error('User service down'))
                .mockResolvedValueOnce({ _id: 'other-789', name: 'Bob' });

            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            const handler = getAllChats(mockChatModel, mockMessagesModel, mockFetchUser);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
            expect(mockFetchUser).toHaveBeenCalledTimes(2);

            const responseData = (res.json as jest.Mock).mock.calls[0][0] as any;
            expect(responseData.chats).toHaveLength(2);
            expect(responseData.chats[0].user).toEqual({ _id: 'other-456', name: 'Unknown User' });
            expect(responseData.chats[1].user).toEqual({ _id: 'other-789', name: 'Bob' });

            consoleSpy.mockRestore();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 5: chat.users contains only the current user (self-chat edge case)
    // ─────────────────────────────────────────────────────────────────────────────
    describe('5. Self-chat — otherUserId is undefined', () => {
        it('should pass undefined to fetchUser and handle the fallback', async () => {
            const selfChat = createMockChat({ users: ['user-123'] });

            (mockChatModel.find as jest.Mock).mockReturnValue({
                sort: jest.fn<() => Promise<MockChat[]>>()
                    .mockResolvedValue([selfChat]),
            });

            (mockMessagesModel.countDocuments as jest.MockedFunction<any>).mockResolvedValue(0);
            mockFetchUser.mockRejectedValue(new Error('Invalid userId'));

            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            const handler = getAllChats(mockChatModel, mockMessagesModel, mockFetchUser);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockFetchUser).toHaveBeenCalledWith(undefined);

            const responseData = (res.json as jest.Mock).mock.calls[0][0] as any;
            expect(responseData.chats[0].user).toEqual({ _id: undefined, name: 'Unknown User' });

            consoleSpy.mockRestore();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 6: Database failure during chatModel.find()
    // ─────────────────────────────────────────────────────────────────────────────
    describe('6. Database error during chatModel.find()', () => {
        it('should return 500 via TryCatch wrapper', async () => {
            (mockChatModel.find as jest.Mock).mockReturnValue({
                sort: jest.fn<() => Promise<any[]>>()
                    .mockRejectedValue(new Error('MongoDB connection timeout')),
            });

            const handler = getAllChats(mockChatModel, mockMessagesModel, mockFetchUser);
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.find).toHaveBeenCalled();
            expect(mockMessagesModel.countDocuments).not.toHaveBeenCalled();
            expect(mockFetchUser).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                message: 'MongoDB connection timeout',
            });
        });
    });
});