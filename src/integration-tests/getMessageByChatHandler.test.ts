import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import express from "express";
import isAuth from "../middlewares/auth.js";
import { getMessageByChat } from "../controllers/getMessageByChat.js";
import { Chat } from "../models/Chat.js";
import { Messages } from "../models/Messages.js";

let mongoServer: MongoMemoryServer;
const app = express();
const JWT_SECRET = "test-secret-key";

app.use(express.json());

const USER_ID_1 = "user123";
const USER_ID_2 = "user456";

const mockFetchUser = jest.fn(async (userId: string) => {
  return {
    _id: userId,
    name: `User ${userId}`,
    email: `${userId}@example.com`,
  };
});

const mockSocketService = {
  emitToRoom: jest.fn(),
  emitToUser: jest.fn(),
  isUserInRoom: jest.fn(),
};

//@ts-ignore
app.get("/messages/:chatId", isAuth, getMessageByChat(Chat, Messages, mockFetchUser, mockSocketService));

const generateToken = (userId: string = USER_ID_1) => {
  return jwt.sign(
    { user: { _id: userId, name: "Test User", email: "test@example.com" } },
    JWT_SECRET
  );
};

describe("GET /messages/:chatId - Integration Tests", () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.JWT_SECRET = JWT_SECRET;
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Chat.deleteMany({});
    await Messages.deleteMany({});
    jest.clearAllMocks();
  });

  it("should fetch all messages for a chat", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create([
      {
        chatId: chat._id,
        sender: USER_ID_1,
        text: "First message",
        messageType: "text",
        seen: true,
      },
      {
        chatId: chat._id,
        sender: USER_ID_2,
        text: "Second message",
        messageType: "text",
        seen: false,
      },
    ]);

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("messages");
    expect(response.body).toHaveProperty("user");
    expect(Array.isArray(response.body.messages)).toBe(true);
    expect(response.body.messages).toHaveLength(2);
  });

  it("should return empty array when chat has no messages", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toEqual([]);
  });

  it("should sort messages by createdAt in ascending order", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const msg1 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_1,
      text: "First message",
      messageType: "text",
      seen: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const msg2 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Second message",
      messageType: "text",
      seen: false,
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages[0].text).toBe("First message");
    expect(response.body.messages[1].text).toBe("Second message");
  });

  it("should mark unseen messages from other users as seen", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create([
      {
        chatId: chat._id,
        sender: USER_ID_2,
        text: "Unseen message 1",
        messageType: "text",
        seen: false,
      },
      {
        chatId: chat._id,
        sender: USER_ID_2,
        text: "Unseen message 2",
        messageType: "text",
        seen: false,
      },
      {
        chatId: chat._id,
        sender: USER_ID_1,
        text: "My message",
        messageType: "text",
        seen: false,
      },
    ]);

    await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const updatedMessages = await Messages.find({ chatId: chat._id });

    const unseenFromOther = updatedMessages.filter(
      (msg) => msg.sender === USER_ID_2
    );
    const myMessage = updatedMessages.find((msg) => msg.sender === USER_ID_1);

    expect(unseenFromOther.every((msg) => msg.seen)).toBe(true);
    expect(myMessage?.seen).toBe(false);
  });

  it("should set seenAt timestamp when marking messages as seen", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Unseen message",
      messageType: "text",
      seen: false,
    });

    await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const updatedMessage = await Messages.findOne({
      chatId: chat._id,
      sender: USER_ID_2,
    });

    expect(updatedMessage?.seen).toBe(true);
    expect(updatedMessage?.seenAt).toBeInstanceOf(Date);
  });

  it("should emit messagesSeen event when messages are marked as seen", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const msg1 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Message 1",
      messageType: "text",
      seen: false,
    });

    const msg2 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Message 2",
      messageType: "text",
      seen: false,
    });

    await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const messageSeenCalls = mockSocketService.emitToUser.mock.calls.filter(
      (call) => call[1] === "messagesSeen"
    );

    expect(messageSeenCalls).toHaveLength(1);
    expect(messageSeenCalls[0][0]).toBe(USER_ID_2);
    expect(messageSeenCalls[0][2]).toMatchObject({
      chatId: chat._id.toString(),
      seenBy: USER_ID_1,
    });
    expect(
      (messageSeenCalls[0][2] as { messageIds: unknown[] }).messageIds
    ).toHaveLength(2);
  });

  it("should not emit messagesSeen event when no unseen messages exist", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Already seen message",
      messageType: "text",
      seen: true,
    });

    await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const messageSeenCalls = mockSocketService.emitToUser.mock.calls.filter(
      (call) => call[1] === "messagesSeen"
    );

    expect(messageSeenCalls).toHaveLength(0);
  });

  it("should include other user data in response", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user._id).toBe(USER_ID_2);
    expect(response.body.user.name).toBe(`User ${USER_ID_2}`);
    expect(response.body.user.email).toBe(`${USER_ID_2}@example.com`);
    expect(mockFetchUser).toHaveBeenCalledWith(USER_ID_2);
  });

  it("should handle fetchUser service failure gracefully", async () => {
    mockFetchUser.mockRejectedValueOnce(new Error("Service unavailable"));

    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user._id).toBe(USER_ID_2);
    expect(response.body.user.name).toBe("Unknown User");
  });

  it("should return 400 when chatId is missing", async () => {
    const token = generateToken(USER_ID_1);

    const response = await request(app)
      .get("/messages/")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it("should return 404 when chat does not exist", async () => {
    const token = generateToken(USER_ID_1);
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .get(`/messages/${fakeId.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message", "Chat not found");
  });

  it("should return 403 when user is not a participant of the chat", async () => {
    const token = generateToken("otherUser");

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty(
      "message",
      "You are not a participant of this chat"
    );
  });

  it("should return 401 when Authorization header is missing", async () => {
    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app).get(
      `/messages/${chat._id.toString()}`
    );

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty(
      "message",
      "Please Login - No Auth header"
    );
  });

  it("should return 401 with invalid token", async () => {
    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", "Bearer invalid-token-xyz");

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Please Login - JWT error");
  });

  it("should return 401 when token does not contain user payload", async () => {
    const invalidToken = jwt.sign({ noUser: true }, JWT_SECRET);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${invalidToken}`);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Invalid token");
  });

  it("should fetch messages with different message types", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create([
      {
        chatId: chat._id,
        sender: USER_ID_1,
        text: "Text message",
        messageType: "text",
        seen: true,
      },
      {
        chatId: chat._id,
        sender: USER_ID_2,
        text: "Image caption",
        image: {
          url: "https://example.com/image.jpg",
          publicId: "chat-images/123",
        },
        messageType: "image",
        seen: false,
      },
    ]);

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages[0].messageType).toBe("text");
    expect(response.body.messages[1].messageType).toBe("image");
    expect(response.body.messages[1].image).toBeTruthy();
  });

  it("should handle multiple calls and mark only unseen messages", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const msg1 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "First unseen",
      messageType: "text",
      seen: false,
    });

    const msg2 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Second unseen",
      messageType: "text",
      seen: false,
    });

    await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    jest.clearAllMocks();

    const msg3 = await Messages.create({
      chatId: chat._id,
      sender: USER_ID_2,
      text: "Third unseen",
      messageType: "text",
      seen: false,
    });

    const response2 = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const messageSeenCalls = mockSocketService.emitToUser.mock.calls.filter(
      (call) => call[1] === "messagesSeen"
    );

    expect(messageSeenCalls).toHaveLength(1);
    expect(
      (messageSeenCalls[0][2] as { messageIds: unknown[] }).messageIds
    ).toHaveLength(1);
  });

  it("should return messages with all expected properties", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create({
      chatId: chat._id,
      sender: USER_ID_1,
      text: "Test message",
      messageType: "text",
      seen: true,
    });

    const response = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const message = response.body.messages[0];

    expect(message).toHaveProperty("_id");
    expect(message).toHaveProperty("chatId");
    expect(message).toHaveProperty("sender");
    expect(message).toHaveProperty("text");
    expect(message).toHaveProperty("messageType");
    expect(message).toHaveProperty("seen");
    expect(message).toHaveProperty("createdAt");
    expect(message).toHaveProperty("updatedAt");
  });

  it("should handle both users fetching messages from same chat", async () => {
    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create([
      {
        chatId: chat._id,
        sender: USER_ID_1,
        text: "Message from user 1",
        messageType: "text",
        seen: false,
      },
      {
        chatId: chat._id,
        sender: USER_ID_2,
        text: "Message from user 2",
        messageType: "text",
        seen: false,
      },
    ]);

    const token1 = generateToken(USER_ID_1);
    const response1 = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token1}`);

    expect(response1.status).toBe(200);
    expect(response1.body.messages).toHaveLength(2);

    const token2 = generateToken(USER_ID_2);
    const response2 = await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token2}`);

    expect(response2.status).toBe(200);
    expect(response2.body.messages).toHaveLength(2);
  });

  it("should not mark user's own unseen messages as seen", async () => {
    const token = generateToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    await Messages.create({
      chatId: chat._id,
      sender: USER_ID_1,
      text: "My unseen message",
      messageType: "text",
      seen: false,
    });

    await request(app)
      .get(`/messages/${chat._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);

    const message = await Messages.findOne({ chatId: chat._id });

    expect(message?.seen).toBe(false);
  });
});
