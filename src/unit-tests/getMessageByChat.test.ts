import { Response } from 'express';
import { Model, Types } from 'mongoose';
import { getMessageByChat } from '../controllers/getMessageByChat.js';
import { IChat } from '../models/Chat.js';
import { IMessage } from '../models/Messages.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';
import { ISocketService } from '../controllers/sendMessage.js';
import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from "@jest/globals";


// ─────────────────────────────────────────────────────────────────────────────
// Explicit Mock Interfaces — every jest.fn is strongly typed
// ─────────────────────────────────────────────────────────────────────────────

interface MockQuery<T> {
    sort: jest.MockedFunction<(arg: any) => Promise<T>>;
}

interface MockChatModel {
    findById: jest.MockedFunction<
        (id: string) => Promise<IChat | null>
    >;
}

interface MockMessagesModel {
    find: jest.MockedFunction<
        (filter: any) => MockQuery<IMessage[]> & PromiseLike<IMessage[]>
    >;

    updateMany: jest.MockedFunction<
        (filter: any, update: any) => Promise<any>
    >;
}

interface MockSocketService extends ISocketService {
    emitToUser: jest.MockedFunction<
        (userId: string, event: string, data: any) => void
    >;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed Mock Factories
// ─────────────────────────────────────────────────────────────────────────────

const createMockQuery = <T>(
    result: T
): MockQuery<T> & PromiseLike<T> => {

    const sortMock: jest.MockedFunction<
        (arg: any) => Promise<T>
    > = jest.fn(
        async (_arg: any): Promise<T> => result
    );

    return {
        sort: sortMock,

        then: <TResult1 = T, TResult2 = never>(
            onfulfilled?:
                | ((value: T) => TResult1 | PromiseLike<TResult1>)
                | null,
            onrejected?:
                | ((reason: any) => TResult2 | PromiseLike<TResult2>)
                | null
        ): PromiseLike<TResult1 | TResult2> => {
            return Promise.resolve(result).then(
                onfulfilled,
                onrejected
            );
        },
    };
};

const createMockChatModel = (): MockChatModel & Model<IChat> => {
    return {
        findById: jest.fn(
            async (_id: string): Promise<IChat | null> => null
        ),
    } as unknown as MockChatModel & Model<IChat>;
};

const createMockMessagesModel = (): MockMessagesModel & Model<IMessage> => {
    return {
        find: jest.fn(
            (_filter: any): MockQuery<IMessage[]> & PromiseLike<IMessage[]> =>
                createMockQuery<IMessage[]>([])
        ),

        updateMany: jest.fn(
            async (_filter: any, _update: any): Promise<any> => ({})
        ),
    } as unknown as MockMessagesModel & Model<IMessage>;
};

const createMockSocketService = (): MockSocketService => {
    return {
        emitToRoom: jest.fn(
            (_room: string, _event: string, _data: any): void => { }
        ),

        emitToUser: jest.fn(
            (_userId: string, _event: string, _data: any): void => { }
        ),

        isUserInRoom: jest.fn(
            (_userId: string, _room: string): boolean => false
        ),
    };
};

const createMockChat = (overrides: Partial<IChat> = {}): IChat => {
    return {
        _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
        users: ['user-123', 'other-456'],
        latestMessage: { text: 'Hello', sender: 'other-456' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        toObject: jest.fn().mockReturnValue({
            _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
            users: ['user-123', 'other-456'],
            latestMessage: { text: 'Hello', sender: 'other-456' },
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-02'),
        }),
        ...overrides,
    } as unknown as IChat;
};

const createMockMessage = (overrides: Partial<IMessage> = {}): IMessage => {
    return {
        _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
        chatId: new Types.ObjectId('507f1f77bcf86cd799439011'),
        sender: 'other-456',
        text: 'Test message',
        messageType: 'text',
        seen: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        ...overrides,
    } as unknown as IMessage;
};

// ─────────────────────────────────────────────────────────────────────────────
// Typed helper to extract response data from res.json mock calls
// ─────────────────────────────────────────────────────────────────────────────

interface GetMessageResponse {
    messages: IMessage[];
    user: any;
}

const getResponseData = (res: Response): GetMessageResponse => {
    const jsonMock = res.json as jest.Mock;
    return jsonMock.mock.calls[0][0] as GetMessageResponse;
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('getMessageByChat Controller — 6 Critical Edge Cases', () => {
    let mockChatModel: MockChatModel & Model<IChat>;
    let mockMessagesModel: MockMessagesModel & Model<IMessage>;
    let mockFetchUser: jest.MockedFunction<
        (id: string) => Promise<any>
    >;
    let mockSocketService: MockSocketService;
    let req: Partial<AuthenticatedRequest>;
    let res: Response;

    beforeEach(() => {
        mockChatModel = createMockChatModel();
        mockMessagesModel = createMockMessagesModel();
        mockFetchUser = jest.fn(
            async (id: string): Promise<any> => ({
                id,
            })
        );
        mockSocketService = createMockSocketService();

        req = {
            user: { _id: 'user-123', name: 'Test User', email: 'test@example.com' } as any,
            params: { chatId: '507f1f77bcf86cd799439011' },
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
        it('should return 401 Unauthorized and never query the database', async () => {
            req.user = null;

            const handler = getMessageByChat(
                mockChatModel,
                mockMessagesModel,
                mockFetchUser,
                mockSocketService
            );
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(res.status).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
            expect(mockChatModel.findById).not.toHaveBeenCalled();
            expect(mockMessagesModel.find).not.toHaveBeenCalled();
            expect(mockMessagesModel.updateMany).not.toHaveBeenCalled();
            expect(mockFetchUser).not.toHaveBeenCalled();
            expect(mockSocketService.emitToUser).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 2: Missing chatId in req.params
    // ─────────────────────────────────────────────────────────────────────────────
    describe('2. Missing chatId in req.params', () => {
        it('should return 400 Bad Request', async () => {
            req.params = {};

            const handler = getMessageByChat(
                mockChatModel,
                mockMessagesModel,
                mockFetchUser,
                mockSocketService
            );
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(res.status).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'ChatId Required' });
            expect(mockChatModel.findById).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 3: Chat not found in database
    // ─────────────────────────────────────────────────────────────────────────────
    describe('3. Chat does not exist', () => {
        it('should return 404 Not Found', async () => {
            mockChatModel.findById.mockResolvedValue(null);

            const handler = getMessageByChat(
                mockChatModel,
                mockMessagesModel,
                mockFetchUser,
                mockSocketService
            );
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.findById).toHaveBeenCalledTimes(1);
            expect(mockChatModel.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Chat not found' });
            expect(mockMessagesModel.find).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 4: User is not a participant in the chat
    // ─────────────────────────────────────────────────────────────────────────────
    describe('4. User is not a participant of the chat', () => {
        it('should return 403 Forbidden', async () => {
            const unauthorizedChat = createMockChat({
                users: ['other-789', 'other-999'],
            });
            mockChatModel.findById.mockResolvedValue(unauthorizedChat);

            const handler = getMessageByChat(
                mockChatModel,
                mockMessagesModel,
                mockFetchUser,
                mockSocketService
            );
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(mockChatModel.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                message: 'You are not a participant of this chat',
            });
            expect(mockMessagesModel.find).not.toHaveBeenCalled();
            expect(mockMessagesModel.updateMany).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 5: Happy path — messages exist, fetchUser succeeds, socket emits
    // ─────────────────────────────────────────────────────────────────────────────
    describe('5. Happy path — messages exist, fetchUser succeeds, socket emits', () => {
        it('should mark messages as seen, emit socket event, and return messages + user', async () => {
            const chat = createMockChat({ users: ['user-123', 'other-456'] });
            const unseenMessage1 = createMockMessage({
                _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
                seen: false,
            });
            const unseenMessage2 = createMockMessage({
                _id: new Types.ObjectId('507f1f77bcf86cd799439033'),
                seen: false,
            });
            const allMessages = [
                unseenMessage1,
                unseenMessage2,
                createMockMessage({
                    _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
                    seen: true,
                }),
            ];

            mockChatModel.findById.mockResolvedValue(chat);

            // First find() for messagesToMarkSeen — no .sort() chained
            const unseenQuery = createMockQuery([unseenMessage1, unseenMessage2]);
            mockMessagesModel.find.mockReturnValueOnce(unseenQuery);

            mockMessagesModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

            // Second find() for messages — .sort() chained
            const sortedQuery = createMockQuery(allMessages);
            mockMessagesModel.find.mockReturnValueOnce(sortedQuery);

            mockFetchUser.mockResolvedValue({ _id: 'other-456', name: 'Alice' });

            const handler = getMessageByChat(
                mockChatModel,
                mockMessagesModel,
                mockFetchUser,
                mockSocketService
            );
            await handler(req as AuthenticatedRequest, res, jest.fn());

            // Verify authorization checks
            expect(mockChatModel.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');

            // Verify messages marked as seen
            expect(mockMessagesModel.find).toHaveBeenNthCalledWith(1, {
                chatId: '507f1f77bcf86cd799439011',
                sender: { $ne: 'user-123' },
                seen: false,
            });
            expect(mockMessagesModel.updateMany).toHaveBeenCalledWith(
                {
                    chatId: '507f1f77bcf86cd799439011',
                    sender: { $ne: 'user-123' },
                    seen: false,
                },
                {
                    seen: true,
                    seenAt: expect.any(Date),
                }
            );

            // Verify final message fetch with sort
            expect(mockMessagesModel.find).toHaveBeenNthCalledWith(2, {
                chatId: '507f1f77bcf86cd799439011',
            });
            expect(sortedQuery.sort).toHaveBeenCalledWith({ createdAt: 1 });

            // Verify socket emission for seen messages
            expect(mockSocketService.emitToUser).toHaveBeenCalledTimes(1);
            expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
                'other-456',
                'messagesSeen',
                {
                    chatId: '507f1f77bcf86cd799439011',
                    seenBy: 'user-123',
                    messageIds: [unseenMessage1._id, unseenMessage2._id],
                }
            );

            // Verify fetchUser called
            expect(mockFetchUser).toHaveBeenCalledWith('other-456');

            // Verify response
            const responseData = getResponseData(res);
            expect(responseData.messages).toEqual(allMessages);
            expect(responseData.user).toEqual({ _id: 'other-456', name: 'Alice' });
            expect(res.json).toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case 6: fetchUser throws error — fallback to Unknown User
    // ─────────────────────────────────────────────────────────────────────────────
    describe('6. fetchUser throws error — fallback to Unknown User', () => {
        it('should still return messages with fallback user data', async () => {
            const chat = createMockChat({ users: ['user-123', 'other-456'] });
            const messages = [createMockMessage()];

            mockChatModel.findById.mockResolvedValue(chat);

            // First find() for messagesToMarkSeen — empty array
            const unseenQuery = createMockQuery([]);
            mockMessagesModel.find.mockReturnValueOnce(unseenQuery);

            mockMessagesModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

            // Second find() for messages — .sort() chained
            const sortedQuery = createMockQuery(messages);
            mockMessagesModel.find.mockReturnValueOnce(sortedQuery);

            mockFetchUser.mockRejectedValue(new Error('User service unavailable'));

            const consoleSpy = jest
                .spyOn(console, 'log')
                .mockImplementation(() => { });

            const handler = getMessageByChat(
                mockChatModel,
                mockMessagesModel,
                mockFetchUser,
                mockSocketService
            );
            await handler(req as AuthenticatedRequest, res, jest.fn());

            expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
            expect(mockFetchUser).toHaveBeenCalledWith('other-456');

            // No socket emission since no messages were marked seen
            expect(mockSocketService.emitToUser).not.toHaveBeenCalled();

            // Verify fallback response
            const responseData = getResponseData(res);
            expect(responseData.messages).toEqual(messages);
            expect(responseData.user).toEqual({
                _id: 'other-456',
                name: 'Unknown User',
            });

            consoleSpy.mockRestore();
        });
    });
});