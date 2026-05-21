import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import express from "express";
import isAuth from "../middlewares/auth.js";
import { createNewChat } from "../controllers/createNewChat.js";
import { Chat } from "../models/Chat.js";

let mongoServer: MongoMemoryServer;
const app = express();
const JWT_SECRET = "test-secret-key";

app.use(express.json());
app.post("/chat/new", isAuth, createNewChat(Chat));

const USER_ID_1 = "user123";
const USER_ID_2 = "user456";

const generateToken = (userId: string = USER_ID_1) => {
  return jwt.sign({ user: { _id: userId, name: "Test User", email: "test@example.com" } }, JWT_SECRET);
};

describe("POST /chat/new - Integration Tests", () => {
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
  });

  it("should create a new chat successfully when otherUserId is provided and valid token is sent", async () => {
    const token = generateToken();

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({ otherUserId: USER_ID_2 });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("message", "New Chat created");
    expect(response.body).toHaveProperty("chatId");
    expect(response.body.chatId).toBeTruthy();

    const createdChat = await Chat.findById(response.body.chatId);
    expect(createdChat).toBeTruthy();
    expect(createdChat?.users).toContain(USER_ID_1);
    expect(createdChat?.users).toContain(USER_ID_2);
    expect(createdChat?.users).toHaveLength(2);
  });

  it("should return existing chat when conversation between two users already exists", async () => {
    const token = generateToken(USER_ID_1);

    const existingChat = await Chat.create({
      users: [USER_ID_1, USER_ID_2],
    });

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({ otherUserId: USER_ID_2 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("message", "Chat already exitst");
    expect(response.body).toHaveProperty("chatId", existingChat._id.toString());
  });

  it("should return 400 when otherUserId is not provided", async () => {
    const token = generateToken();

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("message", "Other userid is required");
  });

  it("should return 401 when Authorization header is missing", async () => {
    const response = await request(app)
      .post("/chat/new")
      .send({ otherUserId: USER_ID_2 });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Please Login - No Auth header");
  });

  it("should return 401 when Authorization header does not start with Bearer", async () => {
    const token = generateToken();

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Basic ${token}`)
      .send({ otherUserId: USER_ID_2 });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Please Login - No Auth header");
  });

  it("should return 401 with invalid token", async () => {
    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", "Bearer invalid-token-xyz")
      .send({ otherUserId: USER_ID_2 });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Please Login - JWT error");
  });

  it("should return 401 when token does not contain user payload", async () => {
    const invalidToken = jwt.sign({ noUser: true }, JWT_SECRET);

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${invalidToken}`)
      .send({ otherUserId: USER_ID_2 });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("message", "Invalid token");
  });

  it("should create chat with different user IDs in reverse order", async () => {
    const token = generateToken(USER_ID_2);

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({ otherUserId: USER_ID_1 });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("message", "New Chat created");

    const createdChat = await Chat.findById(response.body.chatId);
    expect(createdChat?.users).toContain(USER_ID_1);
    expect(createdChat?.users).toContain(USER_ID_2);
  });

  it("should not create duplicate chats even if requested multiple times with same users", async () => {
    const token = generateToken(USER_ID_1);

    const response1 = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({ otherUserId: USER_ID_2 });

    expect(response1.status).toBe(201);
    const chatId1 = response1.body.chatId;

    const response2 = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({ otherUserId: USER_ID_2 });

    expect(response2.status).toBe(200);
    expect(response2.body.chatId).toBe(chatId1);

    const allChats = await Chat.find({});
    expect(allChats).toHaveLength(1);
  });

  it("should set timestamps (createdAt, updatedAt) on new chat creation", async () => {
    const token = generateToken();

    const response = await request(app)
      .post("/chat/new")
      .set("Authorization", `Bearer ${token}`)
      .send({ otherUserId: USER_ID_2 });

    const createdChat = await Chat.findById(response.body.chatId);
    expect(createdChat?.createdAt).toBeInstanceOf(Date);
    expect(createdChat?.updatedAt).toBeInstanceOf(Date);
  });
});
