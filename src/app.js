const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");

const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const subscriberRoutes = require("./routes/subscriberRoutes");
const woocommerceRoutes = require("./routes/woocommerceRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const sequelize = require('./models').sequelize;
const callingNumberExpiryService = require("./services/callingNumberExpiryService");

require("dotenv").config();



const app = express();
app.set('trust proxy', true);
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

sequelize.authenticate()
    .then(() => {
        console.log('Database connected...');
        callingNumberExpiryService.start();
    })
    .catch(err => console.log('Error: ' + err));

// Stripe/PayPal webhook signature verification needs the untouched raw body.
// paymentRoutes.js already declares express.raw()/express.json() on those two
// routes for exactly that reason, but this global parser ran first and consumed
// the stream before they ever saw it — which is why signature verification was
// disabled below. Skip the global parser for those two paths so the route-level
// ones get the real body.
const RAW_BODY_WEBHOOK_PATHS = new Set([
    "/api/payments/stripe/webhook",
    "/api/payments/paypal/webhook",
]);
app.use((req, res, next) => {
    if (RAW_BODY_WEBHOOK_PATHS.has(req.path)) return next();
    bodyParser.json()(req, res, next);
});




// Routes
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/subscribers", subscriberRoutes);
app.use("/api/woocommerce", woocommerceRoutes);
app.use("/api/pricing", pricingRoutes);

// WebSocket connection
io.on("connection", (socket) => {
    console.log("🔌 WebSocket client connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("❌ WebSocket client disconnected:", socket.id);
    });
});


app.get("/api/server-ip", async (req, res) => {
    try {
        // Log raw headers for debugging
        console.log("🔹 Request headers:", req.headers);

        // Detect IP properly behind Cloudflare / RunCloud
        const realIp =
            req.headers["cf-connecting-ip"] || // Cloudflare
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || // reverse proxy chain
            req.connection?.remoteAddress || // fallback
            req.socket?.remoteAddress;

        console.log("🖥️ Client IP:", realIp);

        // For server public IP (outbound IP)
        const os = require("os");
        const localIps = Object.values(os.networkInterfaces())
            .flat()
            .filter((iface) => iface && !iface.internal)
            .map((iface) => iface.address);

        res.json({
            success: true,
            clientIp: realIp,
            localIps,
            cloudflare: req.headers["cf-connecting-ip"] ? true : false,
            forwardedFor: req.headers["x-forwarded-for"] || null,
            serverHost: req.hostname,
        });
    } catch (err) {
        console.error("❌ Error detecting IP:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
