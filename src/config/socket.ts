import { Server, Socket } from "socket.io";
import http from "http";
import express from "express";

const app = express();

const server = http.createServer(app);

//socket.io server
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

//store online user. Bcz server needs to know which socket belongs to which user
const userSocketMap: Record<string, string> = {};

export const getRecieverSocketId = (recieverId: string): string | undefined => {
    return userSocketMap[recieverId];
};

//When a new user connects, this function runs 
//"socket" represents the connected client.
// Each user gets their own "socket" object.
io.on("connection", (socket: Socket) => {

    //Note: 'socket.id' is temporary. They are not equal to userId
    console.log("User connected", socket.id);

    //get userId sent by frontend during socket connection
    const userId = socket.handshake.query.userId as string | undefined;

    if (userId && userId !== "undefined") {
        userSocketMap[userId] = socket.id;
        console.log(`User ${userId} mapped to socket ${socket.id}`);
    }

    //Broadcasts an event to ALL connected clients
    //This sends the list of all online user IDs to every connected client
    io.emit("getOnlineUser", Object.keys(userSocketMap));


    //Joins the room
    if (userId) {
        socket.join(userId);
    }

    socket.on("typing", (data) => {
        console.log(`User ${data.userId} is typing in chat ${data.chatId}`);
        socket.to(data.chatId).emit("userTyping", {
            chatId: data.chatId,
            userId: data.userId,
        });
    });

    socket.on("stopTyping", (data) => {
        console.log(`User ${data.userId} stopped typing in chat ${data.chatId}`);
        socket.to(data.chatId).emit("userStoppedTyping", {
            chatId: data.chatId,
            userId: data.userId,
        });
    });

    socket.on("joinChat", (chatId) => {
        socket.join(chatId);
        console.log(`User ${userId} joined chat room ${chatId}`);
    });

    socket.on("leaveChat", (chatId) => {
        socket.leave(chatId);
        console.log(`User ${userId} left chat room ${chatId}`);
    });

    socket.on("disconnect", () => {
        console.log("User Disconnected", socket.id);

        if (userId) {
            delete userSocketMap[userId];
            console.log(`User ${userId} removed from online users`);
            io.emit("getOnlineUser", Object.keys(userSocketMap));
        }
    });

    socket.on("connect_error", (error) => {
        console.log("Socket connection Error", error);
    });
});

export { app, server, io };