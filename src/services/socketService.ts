import { io, getRecieverSocketId } from "../config/socket.js";
import { ISocketService } from "../controllers/sendMessage.js";

export const socketService: ISocketService = {
    emitToRoom(roomId, event, data) {
        io.to(roomId).emit(event, data);
    },

    emitToUser(userId, event, data) {
        const socketId = getRecieverSocketId(userId);
        if (socketId) {
            io.to(socketId).emit(event, data);
        }
    },

    isUserInRoom(userId, roomId) {
        const socketId = getRecieverSocketId(userId);
        if (!socketId) return false;
        const socket = io.sockets.sockets.get(socketId);
        return socket ? socket.rooms.has(roomId) : false;
    },
};