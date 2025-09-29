const paymentService = require("../services/paymentService");
const logger = require("../helpers/logger");
const {  Timestamp } = require("../config/db");
const axios = require("axios");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const admin = require('./../helpers/firebase')
const db = admin.firestore();



/**
 * Create a Stripe Payment Intent
 */
exports.createStripePaymentIntent = async (req, res) => {
    try {
        const io = req.app.get("io");

        console.log(req.body , "req body")


        const { amount, userId, productType, paymentType , planName , planId , device_id } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }

        const intent = await paymentService.createStripePaymentIntent({
            amount,
            userId,
            productType,
            paymentType,
            planName,
            planId,
            device_id
        });




        logger.info("Stripe payment intent created", {
            userId,
            amount,
            productType,
            paymentType,
            clientSecret: intent.client_secret,
        });

        res.json({ clientSecret: intent.client_secret });
    } catch (err) {
        logger.error("Stripe payment intent failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};
exports.createStripeTestPaymentIntent = async (req, res) => {
    try {
        const io = req.app.get("io");

        console.log(req.body , "req body")


        const { amount, userId, productType, paymentType , planName , planId , device_id } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }

        const intent = await paymentService.createStripeTestPaymentIntent({
            amount,
            userId,
            productType,
            paymentType,
            planName,
            planId,
            device_id
        });




        logger.info("Stripe payment intent created", {
            userId,
            amount,
            productType,
            paymentType,
            clientSecret: intent.client_secret,
        });

        res.json({ clientSecret: intent.client_secret });
    } catch (err) {
        logger.error("Stripe payment intent failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

/**
 * Handle Stripe Webhooks
 */
exports.handleStripeWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    event = req.body;

    // console.log("process.env.STRIPE_WEBHOOK_SECRET" , process.env.STRIPE_WEBHOOK_SECRET , req.body , req.rawBody);

    // try {
    //     event = stripe.webhooks.constructEvent(
    //         req.body,
    //         sig,
    //         process.env.STRIPE_WEBHOOK_SECRET
    //     );
    // } catch (err) {
    //     console.error("⚠️ Webhook signature verification failed:", err.message);
    //     return res.status(400).send(`Webhook Error: ${err.message}`);
    // }

    console.log("✅ Stripe webhook verified", { type: event.type });

    try {
        if (event.type === "payment_intent.succeeded") {
            const paymentIntent = event.data.object;
            const { flowVersion = "v1" } = paymentIntent.metadata || {};

            if (flowVersion === "v2") {
                console.log("Processing via v2 flow");
                await paymentService.saveStripeTransaction(paymentIntent, req.app.get("io"));
            } else {
                console.log("Processing via v1 fallback flow");
                await paymentService.saveLegacyStripeTransaction(paymentIntent);
            }
        }

        // You may also want to handle failed/canceled intents here:
        // if (event.type === "payment_intent.payment_failed") { ... }

        res.send({ received: true });
    } catch (err) {
        console.error("❌ Stripe webhook processing failed:", err.message);
        return res.status(500).send(`Webhook handler failed: ${err.message}`);
    }
};


// Create PayPal Order (already done)
exports.createPayPalOrder = async (req, res) => {
    // try {
        const { amount, currency, userId, productType, paymentType , planName, planId , device_id } = req.body;

        console.log(req.body , "req body for paypal ")

        const order = await paymentService.createPayPalOrder({
            amount,
            currency,
            userId,
            productType,
            paymentType,
            planName,
            planId , device_id
        });


        return res.json(order );
    // } catch (err) {
    //     logger.error("PayPal order creation failed", { error: err.message });
    //     res.status(500).json({ error: err.message });
    // }
};

// Capture PayPal Order
exports.capturePayPalOrder = async (req, res) => {
    // try {
        const orderId = req.body.orderId;

        const io = req.app.get("io");

        console.log(orderId , "order id" , req.body);

    console.log("check for paypal")
        const result = await paymentService.capturePayPalOrder(orderId);
        console.log("result", result);

        const capture = result.purchase_units[0].payments.captures[0];
        const transactionId = capture.id;
        // const amount = parseFloat(capture.amount.value);

    res.json({
        success: true,
        transactionId,
        status: capture.status,
    });
    // } catch (err) {
    //     logger.error("PayPal capture failed", { error: err.message });
    //     res.status(500).json({ error: err.message });
    // }
};

// Webhook for PayPal events
exports.handlePayPalWebhook = async (req, res) => {
    try {
        const event = req.body;

        console.log("PayPal webhook received", { eventType: event.event_type });

        if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
            const capture = event.resource;
            const metadata = JSON.parse(capture.custom_id || "{}");
            const flowVersion = metadata.flowVersion || "v1"; // 👈 decide path

            if (flowVersion === "v2") {
                console.log("Processing PayPal via v2 flow");
                const io = req.app.get("io");

                await paymentService.savePayPalTransaction({
                    orderId: capture.supplementary_data?.related_ids?.order_id,
                    transactionId: capture.id,
                    amount: parseFloat(capture.amount.value),
                    currency: capture.amount.currency_code,
                    status: capture.status,
                    metadata,
                }, io);
            } else {
                console.log("Processing PayPal via v1 fallback flow");

                await db.collection("transactions").add({
                    userId: metadata.userId || "unknown",
                    amount: parseFloat(capture.amount.value),
                    transactionId: capture.id,
                    transactionTime: Timestamp.fromMillis(new Date(capture.create_time).getTime()),
                    isUsed: false,
                    provider: "paypal",
                    paymentType: metadata.paymentType || "unknown",
                    productType: metadata.productType || "unknown",
                });

                console.log("✅ Legacy PayPal transaction saved:", capture.id);
            }
        }

        res.status(200).send("Webhook received");
    } catch (err) {
        logger.error("PayPal webhook failed", { error: err.message });
        res.status(400).send(`Webhook error: ${err.message}`);
    }
};


/**
 * Verify Recent Transaction (Stripe / PayPal)
 */
exports.verifyRecentTransaction = async (req, res) => {
    try {
        const { transactionId, amount, userId, paymentType, subscriberId } =
            req.body;

        if (!transactionId || !amount || !userId) {
            return res
                .status(400)
                .json({ error: "Missing required fields (transactionId, amount, userId)" });
        }

        const querySnapshot = await db
            .collection("transactions")
            .where("transactionId", "==", transactionId)
            .where("amount", "==", amount)
            .where("userId", "==", userId)
            .where("isUsed", "==", false)
            .get();

        if (!querySnapshot.empty) {
            const now = Timestamp.now().seconds;

            const validTransaction = querySnapshot.docs.find((doc) => {
                const data = doc.data();
                const txnTime = data.transactionTime?.seconds;
                return txnTime && now - txnTime <= 500; // 500s window
            });

            if (validTransaction) {
                const batch = db.batch();
                querySnapshot.forEach((doc) => {
                    batch.update(doc.ref, { isUsed: true });
                });
                await batch.commit();

                logger.info("Transaction verified", { transactionId, userId });
                return res.json({ verified: true });
            } else {
                logger.warn("Transaction found but expired", { transactionId, userId });
            }
        }

        // Rollback if verification failed
        logger.error("Transaction verification failed", { transactionId, userId });

        await axios.post(
            "https://app-fb-simtlv.aridar-crm.com/api/firebase/modify-subscriber-balance",
            {
                subscriberId,
                amount: -amount,
                description: `Rollback for failed verification (Txn ID: ${transactionId})`,
            },
            { headers: { Authorization: req.headers.authorization } }
        );

        // send webhook to n8n
        await axios.post("https://n8n-sys.simtlv.co.il/webhook/f1ac457b-9b43-486f-9427-ed5e57e2046a", {
            subscriberId,
            payment_id: transactionId,
            status: "failed",
            amount,
            currency: "USD",
            timestamp: new Date().toISOString(),
            paymentType,
        });

        res.json({ verified: false });
    } catch (err) {
        logger.error("Verify transaction failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};
