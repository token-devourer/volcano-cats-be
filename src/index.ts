import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { VolcanoCatsRoom } from "./transport/VolcanoCatsRoom.js";
import { logger } from "./lib/logger.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";

const app = express();
app.use(
  cors({
    origin: [CLIENT_URL, /\.vercel\.app$/],
    methods: ["GET", "POST"],
    credentials: true,
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});
app.get("/", (_req, res) => {
  res.json({ name: "Volcano Cats Server", status: "running" });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("volcano_cats", VolcanoCatsRoom);

httpServer.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV ?? "development" }, "🌋 Volcano Cats Server running");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  gameServer.gracefullyShutdown().then(() => process.exit(0));
});
