const notificationService = require("../services/notificationService");
const logger = require("../helpers/logger");

/**
 * Send single notification
 */
exports.sendNotification = async (req, res) => {
    try {
        const { token, title, body, data } = req.body;
        const response = await notificationService.sendNotification({ token, title, body, data });

        logger.info("Notification sent", { token, title });
        res.json({ success: true, response });
    } catch (err) {
        logger.error("Notification failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

/**
 * Send notification from CRM (to multiple users by email)
 */
exports.sendNotificationFromCRM = async (req, res) => {
    try {
        const { emails, title, body, route, redeemCode, amount } = req.body;
        const response = await notificationService.sendNotificationFromCRM({
            emails,
            title,
            body,
            route,
            redeemCode,
            amount,
        });

        logger.info("CRM Notification sent", {
            emails,
            title,
            route,
            sentCount: response.successCount,
            failCount: response.failureCount,
        });

        res.json({ success: true, response });
    } catch (err) {
        logger.error("CRM Notification failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};
