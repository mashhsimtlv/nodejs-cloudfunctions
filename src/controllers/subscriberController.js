const subscriberService = require("../services/subscriberService");
const logger = require("../helpers/logger");
const { GooglePhoneOrder } = require("../models");

/**
 * Modify balance (add or deduct credits)
 */
exports.modifyBalance = async (req, res) => {
    try {
        const { subscriberId, amount, description } = req.body;
        const authorization = req.headers.authorization;

        const result = await subscriberService.modifyBalance({
            subscriberId,
            amount,
            description,
            authorization,
        });

        logger.info("Subscriber balance modified", { subscriberId, amount, description });
        res.json(result);
    } catch (err) {
        logger.error("Modify balance failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

/**
 * Modify subscriber status (by ICCID)
 */
exports.modifyStatus = async (req, res) => {
    try {
        const { iccid } = req.body;
        const authorization = req.headers.authorization;

        const result = await subscriberService.modifyStatus({ iccid, authorization });

        logger.info("Subscriber status modified", { iccid });
        res.json(result);
    } catch (err) {
        logger.error("Modify status failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.storeVoicentreWebhook = async (req, res) => {
    const body = req.body;

    console.log("Voicentre Webhook Received:", JSON.stringify(body, null, 2));

    try {
        const record = Array.isArray(body) ? body[0] : body;
        const orderItem = Array.isArray(record?.IVR)
            ? record.IVR.map((step) => step?.layer_name).filter(Boolean).join(" > ")
            : null;

        const payload = {
            googleId: null,
            phone: record?.callerPhone ?? record?.caller ?? null,
            webhookData: JSON.stringify(body),
            type: "voicentre",
            orderNumber: orderItem || record?.ivruniqueid || null,
            orderValue: record?.price ?? null,
        };

        await GooglePhoneOrder.create(payload);

        // ALWAYS respond 200 OK
        return res.status(200).json({ success: true });
    } catch (err) {
        // Only print, do not send 500
        console.error("❌ Voicentre webhook error (ignored):", err.message);
        return res.status(200).json({ success: false });
    }
};
