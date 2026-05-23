import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import isAuth from "../middlewares/auth.js";
import { sendMessage } from "../controllers/sendMessage.js";
import { Chat } from "../models/Chat.js";
import { Messages } from "../models/Messages.js";
import { TEST_PUBLIC_KEY, generateTestToken, generateInvalidPayloadToken } from "../test-helpers/jwtTestKeys.js";

let mongoServer: MongoMemoryServer;
const app = express();

app.use(express.json());

const USER_ID_1 = "user123";
const USER_ID_2 = "user456";

const mockSocketService = {
  emitToRoom: jest.fn(),
  emitToUser: jest.fn(),
  isUserInRoom: jest.fn(),
};

const memoryStorage = multer.memoryStorage();
const upload = multer({ storage: memoryStorage });

const mockFileMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.file) {
    req.file.path = `test-uploads/${req.file.originalname}`;
    req.file.filename = req.file.originalname;
  }
  next();
};

//@ts-ignore
app.post("/message", isAuth, upload.single("image"), mockFileMiddleware, sendMessage(Chat, Messages, mockSocketService));

describe("POST /message - Integration Tests", () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY;
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

  it("should send a text message successfully when user is in chat", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Hello, how are you?",
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("message");
    expect(response.body).toHaveProperty("sender", USER_ID_1);
    expect(response.body.message.text).toBe("Hello, how are you?");
    expect(response.body.message.messageType).toBe("text");
    expect(response.body.message.chatId).toBe(chat._id.toString());
    expect(response.body.message.sender).toBe(USER_ID_1);
  });

  it("should save message to database", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message",
      });

    const savedMessage = await Messages.findOne({ chatId: chat._id });
    expect(savedMessage).toBeTruthy();
    expect(savedMessage?.text).toBe("Test message");
    expect(savedMessage?.sender).toBe(USER_ID_1);
    expect(savedMessage?.seen).toBe(false);
  });

  it("should mark message as seen when receiver is in chat room", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(true);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message",
      });

    expect(response.body.message.seen).toBe(true);
    expect(response.body.message.seenAt).toBeTruthy();

    const savedMessage = await Messages.findById(response.body.message._id);
    expect(savedMessage?.seen).toBe(true);
    expect(savedMessage?.seenAt).toBeInstanceOf(Date);
  });

  it("should not mark message as seen when receiver is not in chat room", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message",
      });

    expect(response.body.message.seen).toBe(false);
    expect(response.body.message.seenAt).toBeNull();
  });

  it("should send message with image file", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .field("chatId", chat._id.toString())
      .field("text", "Check this image")
      .attach("image", Buffer.from("fake-image-data"), "test-image.jpg");

    expect(response.status).toBe(201);
    expect(response.body.message.messageType).toBe("image");
    expect(response.body.message.text).toBe("Check this image");
  });

  it("should update chat's latestMessage when sending text message", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const messageText = "This is the latest message";

    await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: messageText,
      });

    const updatedChat = await Chat.findById(chat._id);
    expect(updatedChat?.latestMessage?.text).toBe(messageText);
    expect(updatedChat?.latestMessage?.sender).toBe(USER_ID_1);
  });

  it("should update chat's latestMessage to emoji when sending image", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .field("chatId", chat._id.toString())
      .field("text", "Optional caption")
      .attach("image", Buffer.from("fake-image-data"), "test-image.jpg");

    const updatedChat = await Chat.findById(chat._id);
    expect(updatedChat?.latestMessage?.text).toBe("📷 Image");
  });

  it("should return 400 when chatId is missing", async () => {
    const token = generateTestToken(USER_ID_1);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        text: "Message without chat",
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message", "ChatId Required");
  });

  it("should return 400 when both text and image are missing", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message", "Either text or image is required");
  });

  it("should return 404 when chat does not exist", async () => {
    const token = generateTestToken(USER_ID_1);
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: fakeId.toString(),
        text: "Message in non-existent chat",
      });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("message", "Chat not found");
  });

  it("should return 403 when user is not a participant of the chat", async () => {
    const token = generateTestToken("otherUser");

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Message from unauthorized user",
      });

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty("message", "You are not a participant of this chat");
  });

  it("should emit socket events to room and users", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message for socket events",
      });

    expect(mockSocketService.emitToRoom).toHaveBeenCalledWith(
      chat._id.toString(),
      "newMessage",
      expect.any(Object)
    );

    expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
      USER_ID_2,
      "newMessage",
      expect.any(Object)
    );

    expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
      USER_ID_1,
      "newMessage",
      expect.any(Object)
    );
  });

  it("should emit messagesSeen event when receiver is in chat room", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(true);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message",
      });

    const messageSeenCalls = mockSocketService.emitToUser.mock.calls.filter(
      (call) => call[1] === "messagesSeen"
    );

    expect(messageSeenCalls).toHaveLength(1);
    expect(messageSeenCalls[0][0]).toBe(USER_ID_1);
    expect(messageSeenCalls[0][2]).toMatchObject({
      chatId: chat._id.toString(),
      seenBy: USER_ID_2,
    });
    expect(
      (messageSeenCalls[0][2] as { messageIds: string[] })
        .messageIds[0]
        .toString()
    ).toBe(response.body.message._id);
  });

  it("should not emit messagesSeen event when receiver is not in chat room", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message",
      });

    const messageSeenCalls = mockSocketService.emitToUser.mock.calls.filter(
      (call) => call[1] === "messagesSeen"
    );
    expect(messageSeenCalls).toHaveLength(0);
  });

  it("should return 401 when Authorization header is missing", async () => {
    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .post("/message")
      .send({
        chatId: chat._id.toString(),
        text: "Message without auth",
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Please Login - No Auth header");
  });

  it("should return 401 with invalid token", async () => {
    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .post("/message")
      .set("Authorization", "Bearer invalid-token-xyz")
      .send({
        chatId: chat._id.toString(),
        text: "Message with invalid token",
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Please Login - JWT error");
  });

  it("should return 401 when token does not contain user payload", async () => {
    const invalidToken = generateInvalidPayloadToken();

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${invalidToken}`)
      .send({
        chatId: chat._id.toString(),
        text: "Message with invalid token payload",
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Invalid token");
  });

  it("should send message with only image and no text caption", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .field("chatId", chat._id.toString())
      .attach("image", Buffer.from("fake-image-data"), "test-image.jpg");

    expect(response.status).toBe(201);
    expect(response.body.message.messageType).toBe("image");
    expect(response.body.message.text).toBe("");
  });

  it("should update chat's updatedAt timestamp", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const initialUpdatedAt = chat.updatedAt;

    mockSocketService.isUserInRoom.mockReturnValue(false);

    await new Promise((resolve) => setTimeout(resolve, 100));

    await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Message to update timestamp",
      });

    const updatedChat = await Chat.findById(chat._id);
    expect(updatedChat?.updatedAt.getTime()).toBeGreaterThan(initialUpdatedAt.getTime());
  });

  it("should create message with correct schema properties", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const response = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Test message properties",
      });

    const savedMessage = await Messages.findById(response.body.message._id);

    expect(savedMessage).toHaveProperty("_id");
    expect(savedMessage).toHaveProperty("chatId");
    expect(savedMessage).toHaveProperty("sender");
    expect(savedMessage).toHaveProperty("text");
    expect(savedMessage).toHaveProperty("messageType");
    expect(savedMessage).toHaveProperty("seen");
    expect(savedMessage).toHaveProperty("createdAt");
    expect(savedMessage).toHaveProperty("updatedAt");
  });

  it("should handle sending multiple messages in same chat", async () => {
    const token = generateTestToken(USER_ID_1);

    const chat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    mockSocketService.isUserInRoom.mockReturnValue(false);

    const response1 = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "First message",
      });

    const response2 = await request(app)
      .post("/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        chatId: chat._id.toString(),
        text: "Second message",
      });

    expect(response1.status).toBe(201);
    expect(response2.status).toBe(201);

    const messages = await Messages.find({ chatId: chat._id });
    expect(messages).toHaveLength(2);

    const updatedChat = await Chat.findById(chat._id);
    expect(updatedChat?.latestMessage?.text).toBe("Second message");
  });
});
