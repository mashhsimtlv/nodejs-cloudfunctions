const subscriberService = require("../services/subscriberService");
const logger = require("../helpers/logger");

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
