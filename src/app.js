const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");

const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const subscriberRoutes = require("./routes/subscriberRoutes");

require("dotenv").config();

const app = express();
const server = http.createServer(app);

// Setup WebSocket
const io = new Server(server, {
    cors: {
        origin: "*", // ⚠️ In production, restrict this to your frontend domain
        methods: ["GET", "POST"]
    }
});

// Store io globally (so controllers can use it)
app.set("io", io);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/subscribers", subscriberRoutes);

// WebSocket connection
io.on("connection", (socket) => {
    console.log("🔌 WebSocket client connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("❌ WebSocket client disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
