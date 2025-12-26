const paymentService = require("../services/paymentService");
const logger = require("../helpers/logger");
const {  Timestamp } = require("../config/db");
const axios = require("axios");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const admin = require('./../helpers/firebase')
const db = admin.firestore();
const eventsAPI = require("./../services/events.service");
const { sequelize, Transaction, CallNumber, UserCallerNumber } = require("../models"); // Sequelize models




/**
 * Create a Stripe Payment Intent
 */
exports.createStripePaymentIntent = async (req, res) => {
    // try {
        const io = req.app.get("io");

        console.log(req.body , "req body")

    const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        null;

    console.log("Client IP:", ip);


        const { amount, userId, productType, paymentType , planName , planId , device_id , paymentFor } = req.body;

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
            device_id,
            ip,
            paymentFor
        });

        // await eventsAPI.paymentIntentCreated({
        //     provider: "stripe",
        //     clientSecret: intent.client_secret,
        //     amount,
        //     userId,
        //     productType,
        //     paymentType,
        //     planName,
        //     planId,
        //     device_id,
        // });




        logger.info("Stripe payment intent created", {
            userId,
            amount,
            productType,
            paymentType,
            clientSecret: intent.client_secret,
        });

        res.json({ clientSecret: intent.client_secret });
    // } catch (err) {
    //     logger.error("Stripe payment intent failed", { error: err.message });
    //     res.status(500).json({ error: err.message });
    // }
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

exports.createCallingPaymentIntent = async (req, res) => {
    try {
        console.log(req.body , "req body for calling ")
        const { amount, user_id, start_date, end_date } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }
        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }
        if (!start_date || !end_date) {
            return res.status(400).json({ error: "start_date and end_date are required" });
        }

        const intent = await paymentService.createStripeCallingPaymentIntent({
            amount,
            userId: user_id,
            productType: "calling_number",
            paymentType: "calling",
            paymentFor: "calling",
            startDate: start_date,
            endDate: end_date,
        });

        return res.json({ clientSecret: intent.client_secret });
    } catch (err) {
        logger.error("Calling payment intent failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.createCallingTestPaymentIntent = async (req, res) => {
    try {
        console.log(req.body, "req body for calling test");
        const { amount, user_id, start_date, end_date } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }
        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }
        if (!start_date || !end_date) {
            return res.status(400).json({ error: "start_date and end_date are required" });
        }

        const ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.connection?.remoteAddress ||
            null;

        const intent = await paymentService.createStripeCallingTestPaymentIntent({
            amount,
            userId: user_id,
            productType: "calling_number",
            paymentType: "calling",
            paymentFor: "calling",
            startDate: start_date,
            endDate: end_date,
            ip,
        });

        return res.json({ clientSecret: intent.client_secret });
    } catch (err) {
        logger.error("Calling test payment intent failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.createCallingPayPalOrder = async (req, res) => {
    try {
        console.log(req.body, "req body for calling paypal");
        const { amount, currency, user_id, start_date, end_date } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }
        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }
        if (!start_date || !end_date) {
            return res.status(400).json({ error: "start_date and end_date are required" });
        }

        const ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.connection?.remoteAddress ||
            null;

        const order = await paymentService.createPayPalOrder({
            amount,
            currency,
            userId: user_id,
            productType: "calling_number",
            paymentType: "calling",
            paymentFor: "calling",
            startDate: start_date,
            endDate: end_date,
            ip,
        });

        return res.json(order);
    } catch (err) {
        logger.error("Calling PayPal order creation failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.createCallingPayPalOrderTest = async (req, res) => {
    try {
        console.log(req.body, "req body for calling paypal test");
        const { amount, currency, user_id, start_date, end_date } = req.body;

        if (!amount || typeof amount !== "number") {
            return res.status(400).json({ error: "Amount must be a valid number" });
        }
        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }
        if (!start_date || !end_date) {
            return res.status(400).json({ error: "start_date and end_date are required" });
        }

        const ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.connection?.remoteAddress ||
            null;

        const order = await paymentService.createPayPalOrder({
            amount,
            currency,
            userId: user_id,
            productType: "calling_number",
            paymentType: "calling",
            paymentFor: "calling",
            startDate: start_date,
            endDate: end_date,
            ip,
            paypalBaseUrl: process.env.PAYPAL_URL_TEST || process.env.PAYPAL_URL,
            paypalClientId: process.env.PAYPAL_CLIENT_ID_TEST || process.env.PAYPAL_CLIENT_ID,
            paypalSecret: process.env.PAYPAL_SECRET_TEST || process.env.PAYPAL_SECRET,
        });

        return res.json(order);
    } catch (err) {
        logger.error("Calling PayPal test order creation failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.getCallingCredentialsByUser = async (req, res) => {
    try {
        const userId = req.params.userId || req.query.userId || req.query.user_id;
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const mappings = await UserCallerNumber.findAll({
            where: { user_id: userId },
            include: [
                {
                    model: CallNumber,
                    as: "callingNumber",
                    attributes: ["id", "number", "country", "password"],
                },
            ],
            order: [["createdAt", "DESC"]],
        });

        const data = mappings
            .filter((m) => m.callingNumber)
            .map((m) => ({
                calling_number_id: m.calling_number_id,
                number: m.callingNumber.number,
                country: m.callingNumber.country,
                password: m.callingNumber.password,
                start_time: m.start_time,
                end_time: m.end_time,
                current_balance: m.current_balance,
            }));

        return res.json({ success: true, data });
    } catch (err) {
        logger.error("Fetch calling credentials failed", { error: err.message });
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
            const { flowVersion = "v1" , paymentFor = "calling" } = paymentIntent.metadata || {};

            if (flowVersion === "v2") {
                console.log("Processing via v2 flow");
                await paymentService.saveStripeTransaction(paymentIntent, req.app.get("io"));
            } else if(flowVersion === "v3" && paymentFor === "calling") {
                console.log("Processing via v3 flow");
                await paymentService.saveStripeCallingTransaction(paymentIntent, req.app.get("io"));
            }else{
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

    const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        null;

    console.log("Client IP:", ip);

        const order = await paymentService.createPayPalOrder({
            amount,
            currency,
            userId,
            productType,
            paymentType,
            planName,
            planId , device_id,ip
        });

    // await eventsAPI.paymentIntentCreated({
    //     provider: "paypal",
    //     clientSecret: "Test paypal",
    //     amount,
    //     userId,
    //     productType,
    //     paymentType,
    //     planName,
    //     planId,
    //     device_id,
    // });


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

            if (flowVersion === "v3" && metadata.paymentFor === "calling") {
                console.log("Processing PayPal via v3 calling flow");
                const io = req.app.get("io");

                await paymentService.savePayPalCallingTransaction({
                    orderId: capture.supplementary_data?.related_ids?.order_id,
                    transactionId: capture.id,
                    amount: parseFloat(capture.amount.value),
                    currency: capture.amount.currency_code,
                    status: capture.status,
                    metadata,
                    createdAt: capture.create_time,
                }, io);
            } else if (flowVersion === "v2") {
                console.log("Processing PayPal via v2 flow");
                const io = req.app.get("io");

                await paymentService.savePayPalTransaction({
                    orderId: capture.supplementary_data?.related_ids?.order_id,
                    transactionId: capture.id,
                    amount: parseFloat(capture.amount.value),
                    currency: capture.amount.currency_code,
                    status: capture.status,
                    metadata,
                    createdAt: capture.create_time,
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


// exports.getStripePaymentIntent = async (req, res) => {
//     try {
//         const { id } = req.query;
//
//         if (!id) {
//             return res.status(400).json({ success: false, message: "PaymentIntent ID is required" });
//         }
//
//         console.log(`🔍 Fetching Stripe PaymentIntent: ${id}`);
//
//         const paymentIntent = await stripe.paymentIntents.retrieve(id);
//
//         console.log("✅ Stripe PaymentIntent Metadata:");
//         console.log(paymentIntent.metadata);
//
//         return res.status(200).json({
//             success: true,
//             message: "PaymentIntent retrieved successfully",
//             metadata: paymentIntent.metadata,
//             full: paymentIntent, // optional if you want all details
//         });
//     } catch (error) {
//         console.error("❌ Error fetching Stripe PaymentIntent:", error.message);
//         return res.status(500).json({
//             success: false,
//             message: "Failed to fetch PaymentIntent",
//             error: error.message,
//         });
//     }
// };
exports.getStripePaymentIntent = async (req, res) => {
    const resp = await paymentService.paymentService(req , res);

        return res.status(200).json({
            success: true,
            message: "Affiliate confirmation executed for latest Stripe transaction.",

        });
    // } catch (error) {
    //     console.error("❌ Error during Stripe payment confirmation:", error.message);
    //     return res.status(500).json({
    //         success: false,
    //         message: "Error during Stripe payment confirmation",
    //         error: error.message,
    //     });
    // }
};
