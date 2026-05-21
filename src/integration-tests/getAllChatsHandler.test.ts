import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import express from "express";
import isAuth from "../middlewares/auth.js";
import { getAllChats } from "../controllers/getAllChats.js";
import { Chat } from "../models/Chat.js";
import { Messages } from "../models/Messages.js";

let mongoServer: MongoMemoryServer;
const app = express();
const JWT_SECRET = "test-secret-key";

app.use(express.json());

const USER_ID_1 = "user123";
const USER_ID_2 = "user456";
const USER_ID_3 = "user789";

const mockFetchUser = jest.fn(async (userId: string) => {
    return {
        _id: userId,
        name: `User ${userId}`,
        email: `${userId}@example.com`,
    };
});

app.get("/chat/all", isAuth, getAllChats(Chat, Messages, mockFetchUser));

const generateToken = (userId: string = USER_ID_1) => {
    return jwt.sign({ user: { _id: userId, name: "Test User", email: "test@example.com" } }, JWT_SECRET);
};

describe("GET /chat/all - Integration Tests", () => {
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

    it("should return all chats for authenticated user with valid token", async () => {
        const token = generateToken(USER_ID_1);

        await Chat.create({
            users: [USER_ID_1, USER_ID_2],
            latestMessage: { text: "Hello", sender: USER_ID_1 },
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("chats");
        expect(Array.isArray(response.body.chats)).toBe(true);
        expect(response.body.chats).toHaveLength(1);
        expect(response.body.chats[0]).toHaveProperty("user");
        expect(response.body.chats[0]).toHaveProperty("chat");
        expect(response.body.chats[0].chat.users).toContain(USER_ID_1);
        expect(response.body.chats[0].chat.users).toContain(USER_ID_2);
    });

    it("should return empty array when user has no chats", async () => {
        const token = generateToken(USER_ID_1);

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats).toEqual([]);
    });

    it("should return only chats where authenticated user is a participant", async () => {
        const token = generateToken(USER_ID_1);

        await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        await Chat.create({
            users: [USER_ID_2, USER_ID_3],
        });

        await Chat.create({
            users: [USER_ID_1, USER_ID_3],
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats).toHaveLength(2);

        const participantIds = response.body.chats.map((c: any) => c.chat._id);
        expect(response.body.chats.every((c: any) => c.chat.users.includes(USER_ID_1))).toBe(true);
    });

    it("should sort chats by updatedAt in descending order", async () => {
        const token = generateToken(USER_ID_1);

        const chat1 = await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const chat2 = await Chat.create({
            users: [USER_ID_1, USER_ID_3],
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats).toHaveLength(2);
        expect(response.body.chats[0].chat._id).toBe(chat2._id.toString());
        expect(response.body.chats[1].chat._id).toBe(chat1._id.toString());
    });

    it("should include unseen message count in response", async () => {
        const token = generateToken(USER_ID_1);

        const chat = await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        await Messages.create({
            chatId: chat._id,
            sender: USER_ID_2,
            text: "Unseen message 1",
            messageType: "text",
            seen: false,
        });

        await Messages.create({
            chatId: chat._id,
            sender: USER_ID_2,
            text: "Unseen message 2",
            messageType: "text",
            seen: false,
        });

        await Messages.create({
            chatId: chat._id,
            sender: USER_ID_1,
            text: "Seen message",
            messageType: "text",
            seen: true,
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats[0].chat.unseenCount).toBe(2);
    });

    it("should not count messages sent by the user as unseen", async () => {
        const token = generateToken(USER_ID_1);

        const chat = await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        await Messages.create({
            chatId: chat._id,
            sender: USER_ID_1,
            text: "My message",
            messageType: "text",
            seen: false,
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats[0].chat.unseenCount).toBe(0);
    });

    it("should include other user data fetched from fetchUser service", async () => {
        const token = generateToken(USER_ID_1);

        await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats[0].user._id).toBe(USER_ID_2);
        expect(response.body.chats[0].user.name).toBe(`User ${USER_ID_2}`);
        expect(response.body.chats[0].user.email).toBe(`${USER_ID_2}@example.com`);
        expect(mockFetchUser).toHaveBeenCalledWith(USER_ID_2);
    });

    it("should handle fetchUser service failure gracefully with Unknown User", async () => {
        mockFetchUser.mockRejectedValueOnce(new Error("Service unavailable"));

        const token = generateToken(USER_ID_1);

        await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats[0].user._id).toBe(USER_ID_2);
        expect(response.body.chats[0].user.name).toBe("Unknown User");
    });

    it("should include latestMessage in response", async () => {
        const token = generateToken(USER_ID_1);

        const latestMsg = { text: "Latest message", sender: USER_ID_2 };
        await Chat.create({
            users: [USER_ID_1, USER_ID_2],
            latestMessage: latestMsg,
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats[0].chat.latestMessage).toEqual(latestMsg);
    });

    it("should return null for latestMessage when chat has no messages", async () => {
        const token = generateToken(USER_ID_1);

        await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(
            response.body.chats[0].chat.latestMessage === null ||
            Object.keys(response.body.chats[0].chat.latestMessage).length === 0
        ).toBe(true);
    });

    it("should return 401 when Authorization header is missing", async () => {
        const response = await request(app).get("/chat/all");

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty("message", "Please Login - No Auth header");
    });

    it("should return 401 with invalid token", async () => {
        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", "Bearer invalid-token-xyz");

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty("message", "Please Login - JWT error");
    });

    it("should return 401 when token does not contain user payload", async () => {
        const invalidToken = jwt.sign({ noUser: true }, JWT_SECRET);

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${invalidToken}`);

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty("message", "Invalid token");
    });

    it("should handle multiple chats with different unseen counts", async () => {
        const token = generateToken(USER_ID_1);

        const chat1 = await Chat.create({
            users: [USER_ID_1, USER_ID_2],
        });

        const chat2 = await Chat.create({
            users: [USER_ID_1, USER_ID_3],
        });

        await Messages.create({
            chatId: chat1._id,
            sender: USER_ID_2,
            text: "Message",
            messageType: "text",
            seen: false,
        });

        await Messages.create({
            chatId: chat2._id,
            sender: USER_ID_3,
            text: "Message 1",
            messageType: "text",
            seen: false,
        });

        await Messages.create({
            chatId: chat2._id,
            sender: USER_ID_3,
            text: "Message 2",
            messageType: "text",
            seen: false,
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.chats).toHaveLength(2);

        const unseenCounts = response.body.chats.map((c: any) => c.chat.unseenCount);
        expect(unseenCounts).toContain(1);
        expect(unseenCounts).toContain(2);
    });

    it("should return chat object with all expected properties", async () => {
        const token = generateToken(USER_ID_1);

        const chat = await Chat.create({
            users: [USER_ID_1, USER_ID_2],
            latestMessage: { text: "Test", sender: USER_ID_2 },
        });

        const response = await request(app)
            .get("/chat/all")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        const chatData = response.body.chats[0].chat;

        expect(chatData).toHaveProperty("_id");
        expect(chatData).toHaveProperty("users");
        expect(chatData).toHaveProperty("latestMessage");
        expect(chatData).toHaveProperty("unseenCount");
        expect(chatData).toHaveProperty("createdAt");
        expect(chatData).toHaveProperty("updatedAt");
    });
});
