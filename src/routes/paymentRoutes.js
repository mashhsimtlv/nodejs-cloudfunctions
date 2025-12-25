const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/stripe/create-intent", paymentController.createStripePaymentIntent);
router.post("/calling/create-intent", paymentController.createCallingPaymentIntent);
router.post("/calling/paypal/create-order", paymentController.createCallingPayPalOrder);
router.post("/stripe/create-test-intent", paymentController.createStripeTestPaymentIntent);
router.post("/stripe/webhook", express.raw({ type: "application/json" }), paymentController.handleStripeWebhook);
router.post("/paypal/create-order", paymentController.createPayPalOrder);
router.post("/paypal/capture-order", paymentController.capturePayPalOrder);
router.post("/paypal/webhook", express.json({ type: "application/json" }), paymentController.handlePayPalWebhook);

router.get("/stripe-intent", paymentController.getStripePaymentIntent);
router.get("/calling/credentials/:userId", paymentController.getCallingCredentialsByUser);
router.get("/calling/credentials", paymentController.getCallingCredentialsByUser);


module.exports = router;
