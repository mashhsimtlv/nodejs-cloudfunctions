const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/stripe/create-intent", paymentController.createStripePaymentIntent);
router.post("/tranzila/create-intent", paymentController.createTranzilaPaymentIntent);
// Tranzila mirror of the two Stripe intent endpoints; /tranzila/notify serves both flows,
// dispatching on the flowVersion stored with the intent.
router.post("/tranzila/create-member-intent", paymentController.createTranzilaMemberPaymentIntent);
router.post("/tranzila/notify", express.urlencoded({ extended: true }), paymentController.handleTranzilaNotify);
router.post("/stripe/create-member-intent", paymentController.createStripeMemberPaymentIntent);
router.post("/calling/create-intent", paymentController.createCallingPaymentIntent);
router.post("/calling/paypal/create-order", paymentController.createCallingPayPalOrder);
router.post("/calling/test/create-intent", paymentController.createCallingTestPaymentIntent);
router.post("/calling/paypal/test/create-order", paymentController.createCallingPayPalOrderTest);
router.post("/stripe/create-test-intent", paymentController.createStripeTestPaymentIntent);
router.post("/stripe/webhook", express.raw({ type: "application/json" }), paymentController.handleStripeWebhook);
router.post("/stripe/test/webhook", express.raw({ type: "application/json" }), paymentController.handleStripeWebhookTest);
router.post("/paypal/create-order", paymentController.createPayPalOrder);
router.post("/paypal/capture-order", paymentController.capturePayPalOrder);
router.post("/paypal/webhook", express.json({ type: "application/json" }), paymentController.handlePayPalWebhook);
router.post("/paypal/test/webhook", express.json({ type: "application/json" }), paymentController.handlePayPalWebhookTest);
router.post("/calling/debug/number-unavailable-email", paymentController.debugCallingNumberUnavailableEmail);
router.post("/calling/update-fcm/:firebaseAuthUid", paymentController.updateCallingFcm);

router.get("/stripe-intent", paymentController.getStripePaymentIntent);
router.get("/calling/availability", paymentController.checkCallingNumberAvailability);
router.post("/calling/availability", paymentController.checkCallingNumberAvailability);
router.get("/calling/credentials/:userId", paymentController.getCallingCredentialsByUser);
router.get("/calling/credentials", paymentController.getCallingCredentialsByUser);


module.exports = router;
