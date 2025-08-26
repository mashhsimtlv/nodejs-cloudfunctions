const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/stripe/create-intent", paymentController.createStripePaymentIntent);
router.post("/stripe/webhook", express.raw({ type: "application/json" }), paymentController.handleStripeWebhook);
router.post("/paypal/create-order", paymentController.createPayPalOrder);
router.post("/paypal/capture-order", paymentController.capturePayPalOrder);

module.exports = router;
