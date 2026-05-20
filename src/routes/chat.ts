import express from "express";
import isAuth from "../middlewares/auth.js";
import { createNewChat } from "../controllers/createNewChat.js"
import { Chat } from "../models/Chat.js";

const router = express.Router();

//Inject the dependency
const createNewChatHandler = createNewChat(Chat);

router.post("/chat/new", isAuth, createNewChatHandler);

export default router;