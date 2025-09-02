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
    async createStripePaymentIntent({ amount, userId, productType, paymentType }) {
        return await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            payment_method_types: ["card"],
            metadata: { userId, productType, paymentType },
        });
    }

    /**
     * Save Stripe Transaction to Firestore & update balances/referrals
     */
    async saveStripeTransaction(paymentIntent , io) {
        try {
            const {metadata, id, amount_received, created} = paymentIntent;
            const userId = metadata.userId;
            const subscriberId = metadata.subscriberId;
            const amountUSD = amount_received / 100;
            const paymentType = metadata.paymentType || "unknown";
            const referredBy = metadata.referredBy || null;


            const txRef = db.collection("transactions").where("transactionId", "==", id).limit(1);

            const txSnap = await txRef.get();

            if(!txSnap.empty){
                logger.warn("Duplicate Stripe webhook ignored", { transactionId: id, userId });
                return;
            }

            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                // logger.warn("Stripe webhook: user not found", {userId});
                return;
            }

            const user = userSnap.data();

            let usdAmount = amountUSD;
            let bonusBalance = 0;

            // Step 2 - Coupon Value Reset after Used

            if (user.couponValue && user.couponValue > 0 && user.couponType) {
                if (user.couponType === "percentageDiscount") {
                    usdAmount = usdAmount - (usdAmount * (user.couponValue / 100));
                }

                await userRef.update({
                    couponValue: 0,
                    couponType: null
                });
            }

            if (user.nextTopupBonus && user.nextTopupBonus.value) {
                usdAmount += user.nextTopupBonus.value;

                await userRef.update({
                    nextTopupBonus: admin.firestore.FieldValue.delete()
                });

                logger.info("Next topup bonus applied", {
                    userId,
                    bonusValue: user.nextTopupBonus.value,
                    couponCode: user.nextTopupBonus.couponCode,
                });

                await this.addHistory(userId, {
                    amount: user.nextTopupBonus.value,
                    bonus: null,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType: paymentType,
                    planName: null,
                    referredBy: "",
                    type: "Next Topup Bonus",
                });
            }


            // Step 3 - Check for Tier

            const tierRates = {silver: 0.05, gold: 0.07, diamond: 0.08, vip: 0.1};
            const rate = tierRates[user.tier] || 0;
            if (amountUSD >= 20 && rate > 0) {
                bonusBalance = amountUSD * rate;
                usdAmount += bonusBalance;
            }

            // Step 4 - Check for Refferal Usage

            if (referredBy && !user.referralUsed) {
                const referrerSnap = await db
                    .collection("app-registered-users")
                    .where("referralCode", "==", referredBy)
                    .limit(1)
                    .get();

                if (!referrerSnap.empty) {
                    const referrer = referrerSnap.docs[0];
                    const referrerId = referrer.id;
                    const refData = referrer.data();

                    const refBonus =
                        refData.tier === "VIP"
                            ? 8
                            : refData.tier === "Diamond"
                                ? 7
                                : refData.tier === "Gold"
                                    ? 6
                                    : 5;

                    await db.collection("app-registered-users").doc(referrerId).update({
                        balance: admin.firestore.FieldValue.increment(refBonus),
                        miles: admin.firestore.FieldValue.increment(600),
                        "referralStats.pendingCount": (refData.referralStats?.pendingCount || 1) - 1,
                    });

                    await this.addHistory(referrerId, {
                        amount: refBonus,
                        bonus: null,
                        currentBonus: null,
                        dateTime: new Date().toISOString(),
                        isPayAsyouGo: true,
                        isTopup: true,
                        paymentType: paymentType,
                        planName: null,
                        referredBy: "",
                        type: "Referral Bonus",
                    });


                    await userRef.update({
                        balance: admin.firestore.FieldValue.increment(5),
                        miles: admin.firestore.FieldValue.increment(600),
                        referralUsed: true,
                    });


                    await this.addHistory(userId, {
                        amount: 5,
                        bonus: null,
                        currentBonus: null,
                        dateTime: new Date().toISOString(),
                        isPayAsyouGo: true,
                        isTopup: true,
                        paymentType: paymentType,
                        planName: null,
                        referredBy: "",
                        type: "Referral Reward",
                    });


                    if (refData.fcmToken) {
                        await this.sendNotification(
                            refData.fcmToken,
                            "Referral Bonus!",
                            "You earned bonus!"
                        );
                    }
                }
            }
        let simtlvToken = null;
        if (user.existingUser) {
            simtlvToken = await getMainToken();
        } else {
            simtlvToken = await getToken();
        }

            if (user.isActive === false) {

                const iccidResult = await iccidService.activeIccid({
                    uid: userId,
                    amount: usdAmount,
                    paymentType,
                    transactionId: id,
                    simtlvToken: simtlvToken
                });



                logger.info("ICCID activation attempted after payment", {
                    userId,
                    transactionId: id,
                    iccidResult,
                });
            }

        let euroAmount = this.usdToEur(usdAmount);

            if(user.iccid) {
                await this.addSimtlvBalance(user.iccid, user , euroAmount , io , simtlvToken)
            }

            const milesToAdd = Math.floor(usdAmount * 100);
            await this.updateMilesAndTier(userId, milesToAdd);

            await db.collection("app-registered-users").doc(userId).update({
                balance: admin.firestore.FieldValue.increment(usdAmount),
            });
            await db.collection("app-registered-users").doc(userId).update({
                balance: admin.firestore.FieldValue.increment(bonusBalance),
            });

            await this.addHistory(userId, {
                amount: usdAmount,
                bonus: bonusBalance,
                currentBonus: null,
                dateTime: new Date().toISOString(),
                isPayAsyouGo: true,
                isTopup: true,
                paymentType: paymentType,
                planName: null,
                referredBy: "",
                type: "TopUp",
            });


            await db.collection("transactions").add({
                userId: metadata.userId || "unknown",
                amount: usdAmount,
                transactionId: id,
                transactionTime: new Date(created * 1000),
                isUsed: false,
                provider: "stripe",
                productType: metadata.productType || "unknown",
                paymentType,
            });




            logger.info("Stripe transaction processed successfully", {
                userId,
                transactionId: id,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });
        } catch (err) {
            // logger.error("saveStripeTransaction error", {error: err.message});
            // await this.notifyAdminEmail("Stripe Webhook Failure", err.message);
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

    async addSimtlvBalance(iccid , user , euroAmount , io , simtlvToken) {

        const subscriberResult = await iccidService.getSingleSubscriber({
            iccid: iccid,
            userData: user
        })

        console.log(subscriberResult , "checking for subscribers Result");

        const subscriberID =  subscriberResult.getSingleSubscriber.sim.subscriberId;


        const requestData = {
            modifySubscriberBalance: {
                subscriber: { subscriberId: subscriberID },
                amount: euroAmount,
                description:  "Optional description"
            }
        };

        console.log(subscriberID , requestData , 'checking for request data');

        const url = `https://ocs-api.telco-vision.com:7443/ocs-custo/main/v1?token=${simtlvToken}`;
        const response = await axios.post(url, requestData, {
            headers: { "Content-Type": "application/json" }
        });

        io.emit("payment_event_"+user.uid, {
            provider: "stripe",
            type: "payment_intent.succeeded",
            data: {"iccid": iccid , "smdpServer": subscriberResult?.getSingleSubscriber?.smdpServer },
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
                auth: {
                    user: process.env.SMTP_USER || "your-email@gmail.com",
                    pass: process.env.SMTP_PASS || "your-app-password", // app password for Gmail
                },
            });

            const mailOptions = {
                from: '"SIMTLV System" <no-reply@simtlv.com>',
                to: "admin@gmail.com",
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

    async createPayPalOrder({ amount, currency, userId, productType, paymentType }) {
        const accessToken = await getPayPalAccessToken();

        // ✅ Store metadata inside reference_id (JSON encoded)
        const referenceData = JSON.stringify({ userId, productType, paymentType });

        const response = await axios.post(
            `${process.env.PAYPAL_API_BASE}/v2/checkout/orders`,
            {
                intent: "CAPTURE",
                purchase_units: [
                    {
                        amount: { currency_code: currency, value: amount.toString() },
                        reference_id: referenceData,
                    },
                ],
            },
            { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
        );

        return response.data;
    }

    // Capture PayPal Order
    async capturePayPalOrder(orderId) {
        const accessToken = await getPayPalAccessToken();

        const response = await axios.post(
            `${process.env.PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
            {},
            { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
        );

        return response.data;
    }

    // Save PayPal Transaction (similar to Stripe)
    async savePayPalTransaction(data, io) {
        try {
            const { transactionId, amount, currency, status, orderId, metadata } = data;
            const userId = metadata?.userId;
            const paymentType = metadata?.paymentType || "paypal";
            const productType = metadata?.productType || "unknown";

            // ✅ Prevent duplicate processing
            const txRef = db.collection("transactions").where("transactionId", "==", transactionId).limit(1);
            const txSnap = await txRef.get();
            if (!txSnap.empty) {
                logger.warn("Duplicate PayPal webhook ignored", { transactionId, userId });
                return;
            }

            // ✅ Fetch user
            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                logger.warn("PayPal webhook: user not found", { userId });
                return;
            }

            const user = userSnap.data();

            // ---- same business logic as Stripe ----
            let usdAmount = amount;
            let bonusBalance = 0;

            // Coupon usage
            if (user.couponValue && user.couponValue > 0) {
                usdAmount += user.couponValue;
                await userRef.update({ couponValue: 0, couponType: null });
            }

            // Tier bonus
            const tierRates = { silver: 0.05, gold: 0.07, diamond: 0.08, vip: 0.1 };
            const rate = tierRates[user.tier] || 0;
            if (amount >= 20 && rate > 0) {
                bonusBalance = amount * rate;
                usdAmount += bonusBalance;
            }

            // (Referral logic can be reused here if needed...)

            // Update balance
            await userRef.update({
                balance: admin.firestore.FieldValue.increment(amount),
            });
            await userRef.update({
                balance: admin.firestore.FieldValue.increment(bonusBalance),
            });

            // Add to history
            await this.addHistory(userId, {
                amount,
                bonus: bonusBalance,
                dateTime: new Date().toISOString(),
                isPayAsyouGo: true,
                isTopup: true,
                paymentType,
                planName: null,
                referredBy: "",
                type: "TopUp",
            });

            // Save transaction
            await db.collection("transactions").add({
                userId,
                amount,
                transactionId,
                transactionTime: new Date(),
                isUsed: false,
                provider: "paypal",
                productType,
                paymentType,
                status,
                orderId,
            });

            logger.info("PayPal transaction processed successfully", {
                userId,
                transactionId,
                amount,
                bonus: bonusBalance,
            });
        } catch (err) {
            logger.error("savePayPalTransaction error", { error: err.message });
        }
    }
}

module.exports = new PaymentService();
