# Real-time Chat App — Chat Microservice

Real-time messaging service with Socket.IO, handling chat rooms, message persistence, and file uploads.

This service manages chat conversations and delivers messages in real time. It verifies JWT tokens using the public key from the User service, fetches user details over HTTP, and broadcasts events through Socket.IO rooms

**Message Flow:**
1. Client sends message via HTTP POST or Socket.IO event
2. Chat Service verifies JWT using the public key from User service
3. Message is persisted to MongoDB
4. Socket.IO broadcasts the message to everyone in the chat room
5. If an image is attached, it is uploaded to Cloudinary first

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (Alpine) |
| Framework | Express.js 5.x + Socket.IO 4.x |
| Language | TypeScript 6.x |
| Database | MongoDB Atlas |
| File Storage | Cloudinary |
| Auth | JWT verification (RS256 public key) |
| Inter-service | Axios HTTP calls to User service |
| Container | Docker multi-stage build |
| Cloud | AWS ECS Fargate |

---
## Project structure
```text
backend/chat/
├── src/
│   ├── config/
│   │   ├── db.ts              # MongoDB connection
│   │   └── socket.ts          # Socket.IO server setup
│   ├── controllers/
│   │   ├── createNewChat.ts   # Create conversation
│   │   ├── getAllChats.ts     # List user's chats
│   │   ├── sendMessage.ts     # Handle message + broadcast
│   │   └── getMessageByChat.ts # Fetch chat history
│   ├── middlewares/
│   │   ├── auth.ts            # JWT verification
│   │   └── multer.ts          # File upload handler
│   ├── models/
│   │   ├── Chat.ts            # Chat room schema
│   │   └── Messages.ts        # Message schema
│   ├── routes/
│   │   └── chat.ts            # Express router
│   ├── services/
│   │   └── socketService.ts   # Socket.IO abstraction
│   └── index.ts               # Entry point
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```
---
## Local Development

Requires the User service and RabbitMQ running on the shared Docker network.

```bash
# Start User service first (creates the shared network)
cd backend/user
docker-compose up -d

# Start Chat service
cd backend/chat
docker-compose up --build
```
---

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `connection` | Client → Server | Client connects, sends `userId` in query |
| `joinChat` | Client → Server | Join a specific chat room |
| `leaveChat` | Client → Server | Leave a chat room |
| `typing` | Client → Server | User is typing |
| `stopTyping` | Client → Server | User stopped typing |
| `getOnlineUser` | Server → All | Broadcast list of online user IDs |
| `userTyping` | Server → Room | Notify room that someone is typing |
| `userStoppedTyping` | Server → Room | Notify room that typing stopped |

---
