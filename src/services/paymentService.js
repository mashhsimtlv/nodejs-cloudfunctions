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
            console.log("Stripe webhook started---------------------")
            const {metadata, id, amount_received, created} = paymentIntent;
            const userId = metadata.userId;
            const subscriberId = metadata.subscriberId;
            const amountUSD = amount_received / 100;
            const paymentType = metadata.paymentType || "unknown";



            const txRef = db.collection("transactions").where("transactionId", "==", id).limit(1);

            const txSnap = await txRef.get();

            if(!txSnap.empty){
                logger.warn("Duplicate Stripe webhook ignored", { transactionId: id, userId });
                return;
            }

            console.log("User Found for the payment")

            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                logger.warn("Stripe webhook: user not found", {userId});
                return;
            }

            const user = userSnap.data();
            const referredBy = user.referredBy || null;

            let usdAmount = amountUSD;
            let bonusBalance = 0;

            // Step 2 - Coupon Value Reset after Used




            if (user.couponValue && user.couponValue > 0 && user.couponType) {
                console.log("Going to Redeem the coupon for percentageDiscount Previous Amount was "+usdAmount);
                if (user.couponType === "percentageDiscount") {
                    // Reverse the discount → find original amount
                    const originalAmount = usdAmount / (1 - (user.couponValue / 100));
                    usdAmount = originalAmount;
                }

                await userRef.update({
                    couponValue: 0,
                    couponType: null
                });
                console.log("Coupon Redeemed for percentageDiscount and payment becomes now: "+ usdAmount);
            }

            if (user.nextTopupBonus && user.nextTopupBonus.value) {
                console.log("Going to Redeem the coupon for NEXT TOPUP Previous Amount was "+usdAmount);
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
                    bonus: 0,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType: paymentType,
                    planName: null,
                    referredBy: "",
                    type: "Next Topup Bonus",
                });
                console.log("Coupon Redeemed for NEXT TOPUP and payment becomes now: "+ usdAmount);
            }


            // Step 3 - Check for Tier

            const tierRates = {silver: 0.05, gold: 0.07, diamond: 0.08, vip: 0.1};
            const rate = tierRates[user.tier] || 0;
            if (amountUSD >= 20 && rate > 0) {
                console.log("Tier Rate applying and previous amount was "+usdAmount);
                bonusBalance = amountUSD * rate;
                usdAmount += bonusBalance;
                console.log("Tier Rate applied and amount now "+usdAmount);
            }

            // Step 4 - Check for Refferal Usage

            console.log("check for reffered by" , referredBy , "refferal used status" , !user.referralUsed)


        let simtlvToken = null;
        if (user.existingUser) {
            simtlvToken = await getMainToken();
        } else {
            simtlvToken = await getToken();
        }
        let iccid = null;

            if (user.isActive === false) {

                console.log("activating iccid")

                const iccidResult = await iccidService.activeIccid({
                    uid: userId,
                    amount: usdAmount,
                    paymentType,
                    transactionId: id,
                    simtlvToken: simtlvToken
                });

                console.log("ICCID activation attempted after payment : ", JSON.stringify({
                    userId,
                    transactionId: id,
                    iccidResult,
                }));

                console.log(iccidResult , "iccid result")

                iccid = iccidResult.iccid;
            }

        let euroAmount = this.usdToEur(usdAmount);

            console.log("User checking for iccid" , user , "here is user" ,user.iccid , "iccid working" ,iccid)

            iccid = user.iccid?user.iccid:iccid;

            console.log("now iccid becomes now" , iccid)

            console.log("checking for refer balance")

            if (referredBy && !user.referralUsed) {
                console.log("going to apply for referal and reffered by "+referredBy+" and reffered to "+userId );
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
                        bonus: 0,
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
                        bonus: 0,
                        currentBonus: null,
                        dateTime: new Date().toISOString(),
                        isPayAsyouGo: true,
                        isTopup: true,
                        paymentType: paymentType,
                        planName: null,
                        referredBy: "",
                        type: "Referral Reward",
                    });


                    let euroAmountUserRef = this.usdToEur(5);
                    console.log("going to add balance")
                    await this.addSimtlvBalance(iccid, user, euroAmountUserRef, io, simtlvToken , "pending");
                    console.log("Balance Added to reffer")
                    let refIccid = refData.iccid;

                    let simtlvRefToken = null;
                    if (refData.existingUser) {
                        simtlvRefToken = await getMainToken();
                    } else {
                        simtlvRefToken = await getToken();
                    }

                    if(refIccid) {

                        // Reffer Balance Add
                        euroAmountUserRef = this.usdToEur(5);
                        await this.addSimtlvBalance(refIccid, refData, euroAmountUserRef, io, simtlvRefToken , "pending");


                        if (refData.fcmToken) {
                            await this.sendNotification(
                                refData.fcmToken,
                                "Referral Bonus!",
                                "You earned bonus!"
                            );
                        }
                    }else{
                        console.log("error: Refferer ICCID not exist" , refData.email);
                    }
                }
            }

            console.log("ended for refer balance")

            console.log("checking for balance for iccid" , iccid);

            if(iccid) {
                console.log("adding balance in simtlv app and amount in euro is " + euroAmount)
                await this.addSimtlvBalance(iccid, user , euroAmount , io , simtlvToken , "completed")
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




            console.log("Stripe transaction processed successfully", {
                userId,
                transactionId: id,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });


            console.log("Stripe webhook ended---------------------")
        } catch (err) {
            logger.error("saveStripeTransaction error", {error: err.message});
            await this.notifyAdminEmail("Stripe Webhook Failure", err.message);
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

    async createPayPalOrder({ amount, currency, userId, productType, paymentType }) {
        const accessToken = await getPayPalAccessToken();

        // ✅ Store metadata inside `custom_id` (same as your Cloud Function)
        const customId = JSON.stringify({ userId, productType, paymentType });

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
        // try {
            console.log("PayPal transaction started---------------------");

            const { transactionId, amount, currency, status, orderId, metadata } = data;
            const userId = metadata?.userId;
            const paymentType = metadata?.paymentType || "paypal";
            const productType = metadata?.productType || "unknown";


            // ✅ Prevent duplicate processing
            const txRef = db.collection("transactions").where("transactionId", "==", transactionId).limit(1);
            const txSnap = await txRef.get();
            if (!txSnap.empty) {
                logger.warn("Duplicate PayPal transaction ignored", { transactionId, userId });
                return;
            }

            console.log("Transaction Is not duplicate");

            // ✅ Fetch user
            const userRef = db.collection("app-registered-users").doc(userId);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                logger.warn("PayPal webhook: user not found", { userId });
                console.log("User Not Found for the payment");
                return;
            }

        console.log("User Found for the payment");

            const user = userSnap.data();

        const referredBy = user.referredBy || null;
            let usdAmount = amount;
            let bonusBalance = 0;

            // Step 2 - Coupon Value Reset after Used
            if (user.couponValue && user.couponValue > 0 && user.couponType) {
                console.log("Going to Redeem the coupon for percentageDiscount Previous Amount was " + usdAmount);

                if (user.couponType === "percentageDiscount") {
                    // Reverse the discount → find original amount
                    const originalAmount = usdAmount / (1 - (user.couponValue / 100));
                    usdAmount = originalAmount;
                }

                await userRef.update({
                    couponValue: 0,
                    couponType: null
                });

                console.log("Coupon Redeemed for percentageDiscount and payment becomes now: " + usdAmount);
            }

            if (user.nextTopupBonus && user.nextTopupBonus.value) {
                console.log("Going to Redeem the coupon for NEXT TOPUP Previous Amount was " + usdAmount);
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

                console.log("Coupon Redeemed for NEXT TOPUP and payment becomes now: " + usdAmount);
            }

            // Step 3 - Check for Tier
            const tierRates = { silver: 0.05, gold: 0.07, diamond: 0.08, vip: 0.1 };
            const rate = tierRates[user.tier] || 0;
            if (amount >= 20 && rate > 0) {
                console.log("Tier Rate applying and previous amount was " + usdAmount);
                bonusBalance = amount * rate;
                usdAmount += bonusBalance;
                console.log("Tier Rate applied and amount now " + usdAmount);
            }



            // Step 5 - ICCID Activation
            let simtlvToken = null;
            if (user.existingUser) {
                simtlvToken = await getMainToken();
            } else {
                simtlvToken = await getToken();
            }

            let iccid=null;

            if (user.isActive === false) {
                console.log("activating iccid");

                const iccidResult = await iccidService.activeIccid({
                    uid: userId,
                    amount: usdAmount,
                    paymentType,
                    transactionId,
                    simtlvToken,
                });

                logger.info("ICCID activation attempted after PayPal payment", {
                    userId,
                    transactionId,
                    iccidResult,
                });
                iccid = iccidResult.iccid;
            }

            // Step 6 - Add SimTLV Balance
            let euroAmount = this.usdToEur(usdAmount);

            iccid = user.iccid?user.iccid:iccid;


        console.log("check for reffered by" , referredBy , "refferal used status" , !user.referralUsed)

        // Step 4 - Check for Referral Usage
        if (referredBy && !user.referralUsed) {
            console.log("going to apply for referral and referred by " + referredBy + " and referred to " + userId);
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
                    refData.tier === "VIP" ? 8 :
                        refData.tier === "Diamond" ? 7 :
                            refData.tier === "Gold" ? 6 : 5;

                await db.collection("app-registered-users").doc(referrerId).update({
                    balance: admin.firestore.FieldValue.increment(refBonus),
                    miles: admin.firestore.FieldValue.increment(600),
                    "referralStats.pendingCount": (refData.referralStats?.pendingCount || 1) - 1,
                });

                await this.addHistory(referrerId, {
                    amount: refBonus,
                    bonus: 0,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType,
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
                    bonus: 0,
                    currentBonus: null,
                    dateTime: new Date().toISOString(),
                    isPayAsyouGo: true,
                    isTopup: true,
                    paymentType,
                    planName: null,
                    referredBy: "",
                    type: "Referral Reward",
                });
                // User Balance Add
                let euroAmountUserRef = this.usdToEur(5);
                await this.addSimtlvBalance(iccid, user, euroAmountUserRef, io, simtlvToken , "pending");

                let refIccid = refData.iccid;

                let simtlvRefToken = null;
                if (refData.existingUser) {
                    simtlvRefToken = await getMainToken();
                } else {
                    simtlvRefToken = await getToken();
                }

                if(refIccid) {

                    // Reffer Balance Add
                    euroAmountUserRef = this.usdToEur(5);
                    await this.addSimtlvBalance(refIccid, refData, euroAmountUserRef, io, simtlvRefToken , "pending");


                    if (refData.fcmToken) {
                        await this.sendNotification(
                            refData.fcmToken,
                            "Referral Bonus!",
                            "You earned bonus!"
                        );
                    }
                }else{
                    console.log("error: Refferer ICCID not exist" , refData.email);
                }
            }
        }

            if (iccid) {
                console.log("adding balance in simtlv app and amount in euro is " + euroAmount);
                await this.addSimtlvBalance(iccid, user, euroAmount, io, simtlvToken , "completed");
            }

            // Step 7 - Miles and Tier update
            const milesToAdd = Math.floor(usdAmount * 100);
            await this.updateMilesAndTier(userId, milesToAdd);

            // Step 8 - Update balances
            await userRef.update({
                balance: admin.firestore.FieldValue.increment(usdAmount),
            });
            await userRef.update({
                balance: admin.firestore.FieldValue.increment(bonusBalance),
            });

            // Step 9 - Add history
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





            // Step 10 - Save transaction
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

            logger.info("PayPal transaction processed successfully", {
                userId,
                transactionId,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });

            console.log("PayPal transaction ended---------------------");
        // } catch (err) {
        //     logger.error("savePayPalTransaction error", { error: err.message });
        // }
    }

}

module.exports = new PaymentService();
