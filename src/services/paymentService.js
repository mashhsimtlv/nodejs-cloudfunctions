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

            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                // logger.warn("Stripe webhook: user not found", {userId});
                return;
            }
            const user = userSnap.data();

            let euroAmount = this.usdToEur(amountUSD);
            let bonusBalance = 0;

            if (user.couponValue && user.couponValue > 0) {
                euroAmount += user.couponValue;
                await userRef.update({couponValue: 0, couponType: null});
            }

            const tierRates = {Silver: 0.05, Gold: 0.07, Diamond: 0.08, VIP: 0.1};
            const rate = tierRates[user.tier] || 0;
            if (amountUSD >= 20 && rate > 0) {
                bonusBalance = this.usdToEur(amountUSD * rate);
                euroAmount += bonusBalance;
            }

            if (paymentType === "PayAsYouGo" && subscriberId) {
            }

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
                        paymentType: "Credit Card",
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
                        paymentType: "Credit Card",
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

            console.log(user.isActive , 'user info')

            if (user.isActive === false) {
                let simtlvToken = null;


                console.log(user.existingUser , 'check existing user')

                if (user.existingUser) {
                    simtlvToken = await getMainToken();
                } else {
                    simtlvToken = await getToken();
                }
                const iccidResult = await iccidService.activeIccid({
                    uid: userId,
                    amount: amountUSD,
                    paymentType,
                    transactionId: id,
                    simtlvToken: simtlvToken
                });

                const milesToAdd = Math.floor(amountUSD * 100);
                await this.updateMilesAndTier(userId, milesToAdd);

                await db.collection("app-registered-users").doc(userId).update({
                    balance: admin.firestore.FieldValue.increment(amountUSD),
                });
                await db.collection("app-registered-users").doc(userId).update({
                    balance: admin.firestore.FieldValue.increment(bonusBalance),
                });



                await this.addHistory(userId, {
                    amount: amountUSD,
                    bonus: bonusBalance,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType: "Credit Card",
                    planName: null,
                    referredBy: "",
                    type: "TopUp",
                });

                const subscriberResult = await iccidService.getSingleSubscriber({
                    iccid: iccidResult.iccid,
                    userData: user
                })

                console.log(iccidResult)
                io.emit("payment_event_"+user.uid, {
                    provider: "stripe",
                    type: "payment_intent.succeeded",
                    data: {"iccid":iccidResult.iccid , "smdpServer": subscriberResult?.getSingleSubscriber?.smdpServer },
                });

                // logger.info("ICCID activation attempted after payment", {
                //     userId,
                //     transactionId: id,
                //     iccidResult,
                // });
            }



            await db.collection("transactions").add({
                userId: metadata.userId || "unknown",
                amount: amountUSD,
                transactionId: id,
                transactionTime: new Date(created * 1000),
                isUsed: false,
                provider: "stripe",
                productType: metadata.productType || "unknown",
                paymentType,
            });




            // logger.info("Stripe transaction processed successfully", {
            //     userId,
            //     transactionId: id,
            //     amountUSD,
            //     credited: euroAmount,
            //     bonus: bonusBalance,
            // });
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

}

module.exports = new PaymentService();
