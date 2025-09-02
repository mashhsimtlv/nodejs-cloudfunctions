const paymentService = require("../services/paymentService");
const logger = require("../helpers/logger");
const { db, Timestamp } = require("../config/db");
const axios = require("axios");

/**
 * Create a Stripe Payment Intent
 */
exports.createStripePaymentIntent = async (req, res) => {
    try {
        const io = req.app.get("io");

        const { amount, userId, productType, paymentType } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }

        const intent = await paymentService.createStripePaymentIntent({
            amount,
            userId,
            productType,
            paymentType,
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
    // try {
        const event = req.body; // ⚠️ use stripe.webhooks.constructEvent in production

        logger.info("Stripe webhook received", { type: event.type });




        if (event.type === "payment_intent.succeeded") {
            const paymentIntent = event.data.object;

            const io = req.app.get("io");

            await paymentService.saveStripeTransaction(paymentIntent , io);
            // logger.info("Stripe transaction saved", { id: event.data.object.id });
        }

        res.send("Webhook received");
    // } catch (err) {
    //     logger.error("Stripe webhook failed", { error: err.message });
    //     res.status(400).send(`Webhook error: ${err.message}`);
    // }
};

// Create PayPal Order (already done)
exports.createPayPalOrder = async (req, res) => {
    // try {
        const { amount, currency, userId, productType, paymentType } = req.body;

        const order = await paymentService.createPayPalOrder({
            amount,
            currency,
            userId,
            productType,
            paymentType,
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
        const { orderId } = req.body;
        const io = req.app.get("io");

        const result = await paymentService.capturePayPalOrder(orderId);

        const capture = result.purchase_units[0].payments.captures[0];
        const transactionId = capture.id;
        const amount = parseFloat(capture.amount.value);

        // Process like Stripe webhook (idempotent)
        await paymentService.savePayPalTransaction({
            orderId,
            transactionId,
            amount,
            currency: capture.amount.currency_code,
            status: capture.status,
            metadata: result.purchase_units[0].reference_id
                ? JSON.parse(result.purchase_units[0].reference_id)
                : {}, // store userId, productType, etc. in reference_id when creating order
        }, io);

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

        logger.info("PayPal webhook received", { eventType: event.event_type });

        if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
            const capture = event.resource;
            const transactionId = capture.id;
            const amount = parseFloat(capture.amount.value);

            const io = req.app.get("io");

            await paymentService.savePayPalTransaction({
                orderId: capture.supplementary_data?.related_ids?.order_id,
                transactionId,
                amount,
                currency: capture.amount.currency_code,
                status: capture.status,
                metadata: {}, // cannot carry metadata in webhook, so store before
            }, io);
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
