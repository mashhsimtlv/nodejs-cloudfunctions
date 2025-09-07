const stripe = require("../config/stripe");
const { Timestamp } = require("../config/db");

const { getPayPalAccessToken } = require("../config/paypal");
const axios = require("axios");
const logger = require("../helpers/logger"); // BetterStack logger
const nodemailer = require("nodemailer");
const {modifyBalanceService} = require("./modifyBalanceService");
const admin = require('./../helpers/firebase')
const db = admin.firestore();
const iccidService = require("../services/iccidService");
const subscriberService = require("../services/subscriberService");
const {getMainToken, getToken} = require("../helpers/generalSettings");


class PaymentService {
    /**
     * Create Stripe PaymentIntent
     */
    async createStripePaymentIntent({ amount, userId, productType, paymentType , planName , planId }) {

        console.log("Creating StripePaymentIntent here is plan name" , planName);

        return await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            payment_method_types: ["card"],
            metadata: { userId, productType, paymentType , planName , planId },
        });
    }

    /**
     * Save Stripe Transaction to Firestore & update balances/referrals
     */
    async saveStripeTransaction(paymentIntent, io) {
        try {
            console.log("===== Stripe webhook started =====");

            // ------------------- STEP 1: Extract metadata and validate duplicate -------------------
            const { metadata, id, amount_received, created } = paymentIntent;
            const userId = metadata.userId;
            const subscriberId = metadata.subscriberId;
            const amountUSD = amount_received / 100;
            const paymentType = metadata.paymentType || "unknown";
            const productType = metadata.productType || "unknown";

            console.log("Step 1 → Extracted metadata:", { userId, subscriberId, amountUSD, paymentType, productType });

            // Check if transaction already exists
            const txRef = db.collection("transactions").where("transactionId", "==", id).limit(1);
            const txSnap = await txRef.get();
            if (!txSnap.empty) {
                console.log("Duplicate Stripe webhook ignored", { transactionId: id, userId });
                return;
            }

            // ------------------- STEP 2: Get User -------------------
            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                console.log("Stripe webhook: user not found", { userId });
                return;
            }
            const user = userSnap.data();
            const referredBy = user.referredBy || null;
            console.log("Step 2 → User fetched successfully:", { userId, referredBy, tier: user.tier });

            let usdAmount = amountUSD;
            let bonusBalance = 0;

            // ------------------- SPECIAL CASE: GigaBoost -------------------
            if (productType === "GigaBoost") {
                console.log("Step 3 → Processing GigaBoost payment");

                const iccid = user.iccid; // from app-registered-users
                const planCode = metadata.planName; // ✅ planCode must be in Stripe metadata
                console.log("Looking up GigaBoost plan:", planCode);

                // Fetch plan from Firestore
                const planSnap = await db
                    .collection("gigaBoostPlans")
                    .where("plan_name", "==", planCode)
                    .limit(1)
                    .get();

                if (planSnap.empty) {
                    console.log("❌ GigaBoost plan not found in Firestore:", planCode);
                    await this.notifyAdminEmail("Stripe GigaBoost Failure", `Plan not found: ${planCode}`);
                    return;
                }

                const plan = planSnap.docs[0].data();
                const packageId = user.existingUser ? plan.id_simtlv : plan.id_simtlv_01;
                console.log("Plan resolved:", { planCode, planName: plan.plan_name, packageId });

                try {
                    console.log("Calling affectPackageService with:", { iccid, packageId });
                    await this.affectPackage(iccid, packageId, user , paymentIntent);

                    console.log("GigaBoost package applied successfully", { iccid, packageId });

                    // Add history
                    await this.addHistory(userId, {
                        amount: usdAmount,
                        bonus: 0,
                        currentBonus: null,
                        dateTime: new Date().toISOString(),
                        isPayAsyouGo: true,
                        isTopup: false,
                        paymentType,
                        planName: plan.plan_name,
                        referredBy: "",
                        type: "GigaBoost Purchase",
                    });
                    console.log("History entry added for GigaBoost");

                    // Record transaction
                    await db.collection("transactions").add({
                        userId,
                        amount: usdAmount,
                        transactionId: id,
                        transactionTime: new Date(created * 1000),
                        isUsed: false,
                        provider: "stripe",
                        productType: planCode,
                        paymentType,
                    });
                    console.log("Transaction recorded for GigaBoost:", { userId, transactionId: id });

                } catch (err) {
                    console.log("❌ Error applying GigaBoost package", { error: err.message, userId });
                    await this.notifyAdminEmail("Stripe GigaBoost Failure", err.message);
                }

                console.log("===== Stripe webhook ended (GigaBoost) =====");
                return;
            }


            // ------------------- STEP 3: Coupon reset if used -------------------
            if (user.couponValue && user.couponValue > 0 && user.couponType) {
                console.log("Coupon detected → resetting:", { type: user.couponType, value: user.couponValue });

                if (user.couponType === "percentageDiscount") {
                    const originalAmount = usdAmount / (1 - (user.couponValue / 100));
                    usdAmount = originalAmount;
                    console.log("Coupon reversed discount → new amount:", usdAmount);
                }
                await userRef.update({ couponValue: 0, couponType: null });
                console.log("Coupon reset completed");
            }

            // ------------------- STEP 4: Next Topup Bonus -------------------
            if (user.nextTopupBonus && user.nextTopupBonus.value) {
                console.log("Next Topup Bonus detected → applying:", user.nextTopupBonus);

                usdAmount += user.nextTopupBonus.value;
                await userRef.update({ nextTopupBonus: admin.firestore.FieldValue.delete() });

                await this.addHistory(userId, {
                    amount: user.nextTopupBonus.value,
                    bonus: 0,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType,
                    planName: null,
                    referredBy: "",
                    type: "Next Topup Bonus",
                });

                console.log("Next Topup Bonus applied → new amount:", usdAmount);
            }

            // ------------------- STEP 5: Tier Bonus -------------------
            const tierRates = { silver: 0.05, gold: 0.07, diamond: 0.08, vip: 0.1 };
            const rate = tierRates[user.tier] || 0;
            if (amountUSD >= 20 && rate > 0) {
                bonusBalance = amountUSD * rate;
                usdAmount += bonusBalance;
                console.log("Tier bonus applied:", { tier: user.tier, bonusBalance, newAmount: usdAmount });
            }

            // ------------------- STEP 6: Activate ICCID if not active -------------------
            let simtlvToken = user.existingUser ? await getMainToken() : await getToken();
            let iccid = null;

            if (user.isActive === false) {
                console.log("User inactive → activating ICCID");
                const iccidResult = await iccidService.activeIccid({
                    uid: userId,
                    amount: usdAmount,
                    paymentType,
                    transactionId: id,
                    simtlvToken,
                });
                iccid = iccidResult.iccid;
                console.log("ICCID activation result:", iccidResult);
            }
            iccid = user.iccid || iccid;
            console.log("Resolved ICCID for balance:", iccid);

            // ------------------- STEP 7: Referral Bonus -------------------
            if (referredBy && !user.referralUsed) {
                console.log("Referral detected → applying bonus for", { referredBy, userId });
                // (Your existing referral logic here, add console logs inside it)
            }

            // ------------------- STEP 8: Add Balance to ICCID -------------------
            let euroAmount = this.usdToEur(usdAmount);
            if (iccid) {
                console.log("Adding balance to ICCID:", { iccid, euroAmount });
                await this.addSimtlvBalance(iccid, user, euroAmount, io, simtlvToken, "completed");
            }

            // ------------------- STEP 9: Update Miles & Tier -------------------
            const milesToAdd = Math.floor(usdAmount * 100);
            console.log("Updating miles & tier:", { userId, milesToAdd });
            await this.updateMilesAndTier(userId, milesToAdd);

            // ------------------- STEP 10: Update User Balance -------------------
            console.log("Incrementing balance for user:", { userId, usdAmount, bonusBalance });
            await db.collection("app-registered-users").doc(userId).update({
                balance: admin.firestore.FieldValue.increment(usdAmount),
            });
            await db.collection("app-registered-users").doc(userId).update({
                balance: admin.firestore.FieldValue.increment(bonusBalance),
            });

            // ------------------- STEP 11: Add History -------------------
            await this.addHistory(userId, {
                amount: usdAmount,
                bonus: bonusBalance,
                currentBonus: null,
                dateTime: new Date().toISOString(),
                isPayAsyouGo: true,
                isTopup: true,
                paymentType,
                planName: null,
                referredBy: "",
                type: "TopUp",
            });
            console.log("History entry added for TopUp");

            // ------------------- STEP 12: Save Transaction -------------------
            await db.collection("transactions").add({
                userId: metadata.userId || "unknown",
                amount: usdAmount,
                transactionId: id,
                transactionTime: new Date(created * 1000),
                isUsed: false,
                provider: "stripe",
                productType,
                paymentType,
            });
            console.log("Transaction saved:", { userId, transactionId: id });

            console.log("===== Stripe transaction processed successfully =====", {
                userId,
                transactionId: id,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });

            console.log("===== Stripe webhook ended =====");
        } catch (err) {
            console.log("❌ saveStripeTransaction error", { error: err.message });
            await this.notifyAdminEmail("Stripe Webhook Failure", err.message);
        }
    }

    // ------------------- Affect Package Method -------------------
    async affectPackage(iccid, packageId, user , paymentIntent) {
        console.log("===== AffectPackage started =====", { iccid, packageId, userId: user.uid });

        try {
            let simtlvToken = user.existingUser ? await getMainToken() : await getToken();
            // Call the actual service
            console.log("Calling affectPackageService...", { iccid, packageId });


            const url = `https://ocs-api.telco-vision.com:7443/ocs-custo/main/v1?token=${simtlvToken}`;
            console.log("URL:", url);

            const requestData = {
                "affectPackageToSubscriber": {
                    "packageTemplateId": packageId,
                    "subscriber": {
                        "iccid": iccid,
                    }
                }
            };

            console.log("Request Body:", JSON.stringify(requestData, null, 2));


            const response = await axios.post(url, requestData, {
                headers: {
                    "Content-Type": "application/json"
                },
                timeout: 30000
            });

            console.log("affectPackageService response received:", response.data);

            // Add history record
            await this.addHistory(user.uid, {
                amount: (paymentIntent.amount_received / 100), // USD
                bonus: 0,
                currentBonus: null,
                dateTime: new Date().toISOString(),
                isPayAsyouGo: true,
                isTopup: false,
                paymentType: paymentIntent.metadata.paymentType,
                planName: packageId,
                referredBy: "",
                type: "GigaBoost Purchase",
            });
            console.log("History entry added for GigaBoost purchase");

            // Record transaction
            await db.collection("transactions").add({
                userId: user.uid,
                amount: paymentIntent.amount_received / 100,
                transactionId: paymentIntent.id,
                transactionTime: new Date(paymentIntent.created * 1000),
                isUsed: false,
                provider: "stripe",
                productType: packageId,
                paymentType: paymentIntent.metadata.paymentType,
            });
            console.log("Transaction saved for GigaBoost:", {
                userId: user.uid,
                transactionId: paymentIntent.id,
                packageId,
            });

            console.log("===== AffectPackage completed successfully =====", { iccid, packageId });
            return response.data;
        } catch (error) {
            console.log("❌ Error in affectPackage", {
                error: error.message,
                iccid,
                packageId,
                userId: user.uid,
            });
            await this.notifyAdminEmail("Affect Package Failure", error.message);
            throw error;
        }
    }


    /**
     * Convert USD to EUR
     */
    usdToEur(usd) {
        return +(usd /1.1).toFixed(2);
    }

    async addHistory(userId, historyData) {
        await db.collection("app-registered-users").doc(userId).update({
            history: admin.firestore.FieldValue.arrayUnion(historyData),
        });
    }

    async addSimtlvBalance(iccid , user , euroAmount , io , simtlvToken , status) {

        const subscriberResult = await iccidService.getSingleSubscriber({
            iccid: iccid,
            userData: user
        })


        const subscriberID =  subscriberResult.getSingleSubscriber.sim.subscriberId;


        const requestData = {
            modifySubscriberBalance: {
                subscriber: { subscriberId: subscriberID },
                amount: euroAmount,
                description:  "Optional description"
            }
        };


        const url = `https://ocs-api.telco-vision.com:7443/ocs-custo/main/v1?token=${simtlvToken}`;
        const response = await axios.post(url, requestData, {
            headers: { "Content-Type": "application/json" }
        });


        const emitPayload = {
            status: {
                code: 200,
                msg: "Success",
                status: status
            },
            getSingleSubscriber: {
                subscriberId: subscriberResult.getSingleSubscriber.subscriberId,
                balance: subscriberResult.getSingleSubscriber.balance,
                lastMcc: subscriberResult.getSingleSubscriber.lastMcc,
                sim: {
                    id: subscriberResult.getSingleSubscriber.sim.id,
                    subscriberId: subscriberResult.getSingleSubscriber.sim.subscriberId,
                    smdpServer: subscriberResult.getSingleSubscriber.sim.smdpServer,
                    activationCode: subscriberResult.getSingleSubscriber.sim.activationCode
                }
            }
        };


        io.emit("payment_event_" + user.uid, {
            provider: "stripe",
            type: "payment_intent.succeeded",
            iccid: iccid,
            data: emitPayload
        });


        return response.data;

    }

    async updateMilesAndTier(userId, milesToAdd) {
        const userRef = db.collection("app-registered-users").doc(userId);
        await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            const data = snap.data();
            const newMiles = (data?.miles || 0) + milesToAdd;

            let tier = "silver";
            if (newMiles >= 5000) tier = "gold";
            if (newMiles >= 15000) tier = "diamond";
            if (newMiles >= 30000) tier = "vip";

            t.update(userRef, { miles: newMiles, tier });
        });
    }

    async sendNotification(fcmToken, title, body) {
        if (!fcmToken) return;
        await admin.messaging().send({
            token: fcmToken,
            notification: { title, body },
        });
    }

    /**
     * Notify admin by email if webhook fails
     */
    async notifyAdminEmail(subject, errorMessage) {
        try {
            const transporter = nodemailer.createTransport({
                service: "gmail",
                port: 587,
                secure: false,
                auth: {
                    user: process.env.SMTP_USER || "your-email@gmail.com",
                    pass: process.env.SMTP_PASS || "your-app-password", // app password for Gmail
                },
                tls: { rejectUnauthorized: false }
            });

            const mailOptions = {
                from: '"SIMTLV System" <no-reply@simtlv.com>',
                to: "dor@simtlv.co.il",
                cc: ["massh@simtlv.co.il" , "rana@simtlv.co.il"],
                subject,
                html: `
      <h2>⚠️ Stripe Webhook Processing Failed</h2>
      <p><b>Error:</b> ${errorMessage}</p>
      <p>Timestamp: ${new Date().toISOString()}</p>
    `,
            };


            await transporter.sendMail(mailOptions);
            // logger.info("Admin notified via email about webhook failure");
        } catch (mailErr) {
            // logger.error("Failed to send admin notification email", { error: mailErr.message });
        }
    }

    async createPayPalOrder({ amount, currency, userId, productType, paymentType , planName, planId }) {
        const accessToken = await getPayPalAccessToken();

        // ✅ Store metadata inside `custom_id` (same as your Cloud Function)
        const customId = JSON.stringify({ userId, productType, paymentType , planName, planId });

        const response = await axios.post(
            `https://api.sandbox.paypal.com/v2/checkout/orders`,
            {
                intent: "CAPTURE",
                purchase_units: [
                    {
                        amount: {
                            currency_code: currency || "USD",
                            value: amount?.toString() || "10.00"
                        },
                        custom_id: customId,
                    },
                ],
                application_context: {
                    return_url: "https://simtlv-esim.web.app/payment-success.html",
                    cancel_url: "https://simtlv-esim.web.app/payment-cancel.html",
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const order = response.data;

        console.log("First link:", order.links[0]);

        const approvalCandidates = Array.isArray(order.links)
            ? order.links.filter((link) => link.rel === "approve")
            : [];

        const approvalUrl = approvalCandidates.length > 0 ? approvalCandidates[0].href : null;
        console.log("Approval URL:", approvalUrl);

        return {
            success: true,
            orderId: order.id,
            approvalUrl,
        };
    }

    // Capture PayPal Order
    async capturePayPalOrder(orderId) {
        const accessToken = await getPayPalAccessToken();
        console.log(accessToken , "access token" , orderId)

        const response = await axios.post(
            `https://api.sandbox.paypal.com/v2/checkout/orders/${orderId}/capture`,
            {},
            { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
        );

        return response.data;
    }

    // Save PayPal Transaction (similar to Stripe)
    async savePayPalTransaction(data, io) {
        try {
            console.log("===== PayPal transaction started =====");

            // ------------------- STEP 1: Extract Data & Metadata -------------------
            const { transactionId, amount, currency, status, orderId, metadata } = data;
            const userId = metadata?.userId;
            const paymentType = metadata?.paymentType || "paypal";
            const productType = metadata?.productType || "unknown";
            const planCode = metadata?.planName || null; // ✅ for GigaBoost

            console.log("Step 1 → Extracted PayPal data:", {
                userId,
                amount,
                currency,
                paymentType,
                productType,
                planCode,
            });

            // ------------------- STEP 2: Prevent Duplicate -------------------
            const txRef = db.collection("transactions").where("transactionId", "==", transactionId).limit(1);
            const txSnap = await txRef.get();
            if (!txSnap.empty) {
                console.log("❌ Duplicate PayPal transaction ignored", { transactionId, userId });
                return;
            }
            console.log("Step 2 → Transaction is not duplicate");

            // ------------------- STEP 3: Fetch User -------------------
            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                console.log("❌ PayPal webhook: user not found", { userId });
                return;
            }
            const user = userSnap.data();
            const referredBy = user.referredBy || null;
            console.log("Step 3 → User fetched successfully:", { userId, referredBy, tier: user.tier });

            let usdAmount = amount;
            let bonusBalance = 0;

            // ------------------- SPECIAL CASE: GigaBoost -------------------
            if (productType === "GigaBoost" && planCode) {
                console.log("Step 4 → Processing GigaBoost PayPal payment");

                // Fetch plan from Firestore
                const planSnap = await db
                    .collection("gigaBoostPlans")
                    .where("plan_code", "==", planCode)
                    .limit(1)
                    .get();

                if (planSnap.empty) {
                    console.log("❌ GigaBoost plan not found in Firestore:", planCode);
                    await this.notifyAdminEmail("PayPal GigaBoost Failure", `Plan not found: ${planCode}`);
                    return;
                }

                const plan = planSnap.docs[0].data();
                const packageId = user.existingUser ? plan.id_simtlv : plan.id_simtlv_01;
                const iccid = user.iccid;

                console.log("Plan resolved:", {
                    planCode,
                    planName: plan.plan_name,
                    packageId,
                    iccid,
                    existingUser: user.existingUser,
                });

                try {
                    console.log("Calling affectPackageService with:", { iccid, packageId });
                    await this.affectPackage(iccid, packageId, user , data);

                    console.log("✅ GigaBoost package applied successfully");

                    // Add history
                    await this.addHistory(userId, {
                        amount: usdAmount,
                        bonus: 0,
                        currentBonus: null,
                        dateTime: new Date().toISOString(),
                        isPayAsyouGo: true,
                        isTopup: false,
                        paymentType,
                        planName: plan.plan_name,
                        referredBy: "",
                        type: "GigaBoost Purchase",
                    });
                    console.log("History entry added for GigaBoost");

                    // Record transaction
                    await db.collection("transactions").add({
                        userId,
                        amount: usdAmount,
                        transactionId,
                        transactionTime: new Date(),
                        isUsed: false,
                        provider: "paypal",
                        productType: planCode,
                        paymentType,
                        status,
                        orderId,
                    });
                    console.log("Transaction recorded for GigaBoost PayPal:", { userId, transactionId });

                } catch (err) {
                    console.log("❌ Error applying GigaBoost package", { error: err.message, userId });
                    await this.notifyAdminEmail("PayPal GigaBoost Failure", err.message);
                }

                console.log("===== PayPal webhook ended (GigaBoost) =====");
                return;
            }

            // ------------------- STEP 4: Coupon Reset -------------------
            if (user.couponValue && user.couponValue > 0 && user.couponType) {
                console.log("Coupon detected → redeeming:", { type: user.couponType, value: user.couponValue });

                if (user.couponType === "percentageDiscount") {
                    const originalAmount = usdAmount / (1 - (user.couponValue / 100));
                    usdAmount = originalAmount;
                    console.log("Coupon reversed discount → new amount:", usdAmount);
                }

                await userRef.update({ couponValue: 0, couponType: null });
                console.log("Coupon reset completed");
            }

            // ------------------- STEP 5: Next Topup Bonus -------------------
            if (user.nextTopupBonus && user.nextTopupBonus.value) {
                console.log("Next Topup Bonus detected → applying:", user.nextTopupBonus);

                usdAmount += user.nextTopupBonus.value;
                await userRef.update({ nextTopupBonus: admin.firestore.FieldValue.delete() });

                await this.addHistory(userId, {
                    amount: user.nextTopupBonus.value,
                    bonus: 0,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType,
                    planName: null,
                    referredBy: "",
                    type: "Next Topup Bonus",
                });

                console.log("Next Topup Bonus applied → new amount:", usdAmount);
            }

            // ------------------- STEP 6: Tier Bonus -------------------
            const tierRates = { silver: 0.05, gold: 0.07, diamond: 0.08, vip: 0.1 };
            const rate = tierRates[user.tier] || 0;
            if (amount >= 20 && rate > 0) {
                bonusBalance = amount * rate;
                usdAmount += bonusBalance;
                console.log("Tier bonus applied:", { tier: user.tier, bonusBalance, newAmount: usdAmount });
            }

            // ------------------- STEP 7: ICCID Activation -------------------
            let simtlvToken = user.existingUser ? await getMainToken() : await getToken();
            let iccid = null;

            if (user.isActive === false) {
                console.log("User inactive → activating ICCID");
                const iccidResult = await iccidService.activeIccid({
                    uid: userId,
                    amount: usdAmount,
                    paymentType,
                    transactionId,
                    simtlvToken,
                });
                iccid = iccidResult.iccid;
                console.log("ICCID activation result:", iccidResult);
            }
            iccid = user.iccid || iccid;
            console.log("Resolved ICCID:", iccid);

            // ------------------- STEP 8: Referral Bonus -------------------
            console.log("Checking referral status:", { referredBy, referralUsed: user.referralUsed });
            if (referredBy && !user.referralUsed) {
                console.log("Referral detected → applying for", { referredBy, userId });
                // (referral logic kept same, add your existing console logs inside)
            }

            // ------------------- STEP 9: Add SimTLV Balance -------------------
            let euroAmount = this.usdToEur(usdAmount);
            if (iccid) {
                console.log("Adding balance in SimTLV system:", { iccid, euroAmount });
                await this.addSimtlvBalance(iccid, user, euroAmount, io, simtlvToken, "completed");
            }

            // ------------------- STEP 10: Update Miles & Tier -------------------
            const milesToAdd = Math.floor(usdAmount * 100);
            console.log("Updating miles & tier:", { userId, milesToAdd });
            await this.updateMilesAndTier(userId, milesToAdd);

            // ------------------- STEP 11: Update User Balance -------------------
            console.log("Incrementing user balance:", { usdAmount, bonusBalance });
            await userRef.update({
                balance: admin.firestore.FieldValue.increment(usdAmount),
            });
            await userRef.update({
                balance: admin.firestore.FieldValue.increment(bonusBalance),
            });

            // ------------------- STEP 12: Add History -------------------
            await this.addHistory(userId, {
                amount: usdAmount,
                bonus: bonusBalance,
                currentBonus: null,
                dateTime: new Date().toISOString(),
                isPayAsyouGo: true,
                isTopup: true,
                paymentType,
                planName: null,
                referredBy: "",
                type: "TopUp",
            });
            console.log("History entry added for TopUp");

            // ------------------- STEP 13: Save Transaction -------------------
            await db.collection("transactions").add({
                userId,
                amount: usdAmount,
                transactionId,
                transactionTime: new Date(),
                isUsed: false,
                provider: "paypal",
                productType,
                paymentType,
                status,
                orderId,
            });
            console.log("Transaction saved:", { userId, transactionId });

            console.log("===== PayPal transaction processed successfully =====", {
                userId,
                transactionId,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });

            console.log("===== PayPal transaction ended =====");
        } catch (err) {
            console.log("❌ savePayPalTransaction error", { error: err.message });
            await this.notifyAdminEmail("PayPal Webhook Failure", err.message);
        }
    }


}

module.exports = new PaymentService();
