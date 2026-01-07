const express = require("express");
const router = express.Router();
const subscriberController = require("../controllers/subscriberController");
const logger = require("../helpers/logger");
const paymentService = require("../services/paymentService");

router.post("/modify-balance", subscriberController.modifyBalance);
router.post("/modify-status", subscriberController.modifyStatus);
router.post("/voicentre-webhook", subscriberController.storeVoicentreWebhook);

router.get('/test' ,  async (req, res) => {
    await paymentService.notifyAdminEmail("Stripe Webhook Failure", "New Error")
    return res.status(200).json("test")
})

module.exports = router;
