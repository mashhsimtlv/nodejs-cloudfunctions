const winston = require("winston");
const axios = require("axios");

// Use the endpoint provided for your source
const BETTERSTACK_URL = "https://s1488664.eu-nbg-2.betterstackdata.com";
const SOURCE_TOKEN = "WfCsYoDMYjuJjbxE3NiASmMY";

class BetterStackTransport extends winston.Transport {
    log(info, callback) {
        setImmediate(() => this.emit("logged", info));

        axios.post(
            BETTERSTACK_URL,
            {
                level: info.level,
                message: info.message,
                timestamp: new Date().toISOString(),
                meta: info.meta || {},
                source: "node_js_cloud_functions", // optional, adds clarity
            },
            {
                headers: {
                    Authorization: `Bearer ${SOURCE_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        ).catch((err) => {
            console.error("⚠️ BetterStack logging failed:", err.message);
        });

        callback();
    }
}

const logger = winston.createLogger({
    level: "info",
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new BetterStackTransport(),
    ],
});

module.exports = logger;
