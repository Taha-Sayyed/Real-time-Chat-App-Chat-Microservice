import express from "express";
import isAuth from "../middlewares/auth.js";
import { createNewChat } from "../controllers/createNewChat.js"
import { getAllChats } from "../controllers/getAllChats.js"
import { Chat } from "../models/Chat.js";
import { Messages } from "../models/Messages.js"
import axios from "axios";

const router = express.Router();

const fetchUser = async (userId: string) => {
    const { data } = await axios.get(
        `${process.env.USER_SERVICE}/api/v1/user/${userId}`
    );
    return data;
};

//Inject the dependency
const createNewChatHandler = createNewChat(Chat);
const getAllChatsHandler = getAllChats(Chat, Messages, fetchUser);


router.post("/chat/new", isAuth, createNewChatHandler);
router.get("/chat/all", isAuth, getAllChatsHandler);

export default router;