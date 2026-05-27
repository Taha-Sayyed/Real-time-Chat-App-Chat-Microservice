import express from "express";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
import chatRoutes from "./routes/chat.js";
import cors from "cors";
import { app, server } from "./config/socket.js";
// import dns from "node:dns/promises";


// //👇For Development only
// dns.setServers(["1.1.1.1"]);
// //👆For Development only

dotenv.config();

connectDb();

app.use(express.json());

app.use(cors());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    message: "Chat Service is Healthy ✅"
  });
});

app.get("/api/v1/chat/health", (req, res) => {
  res.status(200).json({
    message: "Chat Service is Healthy ✅"
  });
});

app.use("/api/v1/chat", chatRoutes);

const port = process.env.PORT;


server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});