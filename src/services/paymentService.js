const stripe = require("../config/stripe");
const stripeTest = require("../config/streipe-test");
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
const { sequelize, Transaction } = require("../models"); // Sequelize models



class PaymentService {
    /**
     * Create Stripe PaymentIntent
     */
    async createStripePaymentIntent({ amount, userId, productType, paymentType , planName , planId , device_id }) {

        console.log("Here is the device id " , device_id);

        return await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            payment_method_types: ["card"],
            statement_descriptor: "SIMTLV - eSIM&Sim",
            metadata: { userId, productType, paymentType , planName , planId , flowVersion: "v2" , device_id},
        });
    }
    async createStripeTestPaymentIntent({ amount, userId, productType, paymentType , planName , planId , device_id }) {

        console.log("Here is the device id " , device_id);

        return await stripeTest.paymentIntents.create({
            amount,
            currency: "usd",
            payment_method_types: ["card"],
            // statement_descriptor: "SIMTLV - eSIM&Sim",
            metadata: { userId, productType, paymentType , planName , planId , flowVersion: "v2" , device_id},
        });
    }

    delayedEmit(io, event, data, delay = 5000) {
        setTimeout(() => {
            io.emit(event, data);
        }, delay);
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


            const [result, createdRow] = await Transaction.findOrCreate({
                where: { transaction_id: id },
                defaults: {
                    user_id: userId,
                    transaction_id: id,
                    amount: amountUSD,
                    provider: "stripe",
                    product_type: productType,
                    payment_type: paymentType,
                    createdAt: new Date(created * 1000),
                },
            });

            if (!createdRow) {
                console.log("Duplicate transaction ignored:", id);
                return;
            }

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
                let iccidGiga = user.iccid;
                const planCode = metadata.planName; // ✅ planCode must be in Stripe metadata
                console.log("Looking up GigaBoost plan:", planCode);

                let simtlvGigaToken = user.existingUser ? await getMainToken() : await getToken();

                console.log(simtlvGigaToken , "token before the active iccid sim")

                let sendSocketForPlan = true;

                let emitPayload = null;

                if(user.isActive === false){
                    sendSocketForPlan = false;
                    console.log("SIm is not active , going to activate the sim in GIGABOOST PLAN")
                    simtlvGigaToken = await getMainToken();
                    console.log(simtlvGigaToken , "simtlv giga token")
                    let iccidResultGiga = await iccidService.activeIccid({
                        uid: userId,
                        amount: usdAmount,
                        paymentType,
                        transactionId: id,
                        simtlvToken: simtlvGigaToken,
                    });
                    if(!iccidGiga){
                        iccidGiga = iccidResultGiga.iccid;
                        console.log("ICCID activation result:", iccidGiga);
                    }


                    const subscriberResult = await iccidService.getSingleSubscriber({
                        iccid: iccidResultGiga.iccid,
                        userData: user
                    })


                    const subscriberID =  subscriberResult.getSingleSubscriber.sim.subscriberId;


                    emitPayload = {
                        status: {
                            code: 200,
                            msg: "Success",
                            status: "completed"
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


                }

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
                    console.log("Calling affectPackageService with:", { iccidGiga, packageId });
                    await this.affectPackage(iccidGiga, packageId, user , paymentIntent);

                    console.log("GigaBoost package applied successfully", { iccidGiga, packageId });

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
                        isUsed: true,
                        provider: "stripe",
                        productType: planCode,
                        paymentType,
                    });

                    await Transaction.update(
                        { amount: usdAmount, product_type: productType, payment_type: paymentType },
                        { where: { transaction_id: id } }
                    );

                    console.log("Transaction recorded for GigaBoost:", { userId, transactionId: id });

                } catch (err) {
                    console.log("❌ Error applying GigaBoost package", { error: err.message, userId });
                    await this.notifyAdminEmail("Stripe GigaBoost Failure", err.message);
                }
                if(!emitPayload) {
                    emitPayload = {
                        status: {
                            code: 200,
                            msg: "Success",
                            status: "completed"
                        },
                        getSingleSubscriber: {
                            subscriberId: null,
                            balance: null,
                            lastMcc: null,
                            sim: {
                                id: null,
                                subscriberId: null,
                                smdpServer: null,
                                activationCode: iccidGiga ? iccidGiga : "testiccid"
                            }
                        }
                    };
                }


                this.delayedEmit(io, "payment_event_" + user.uid, {
                    provider: "stripe",
                    type: "payment_intent.succeeded",
                    iccid: iccidGiga,
                    data: emitPayload
                });


                const payload = {
                    totalPaymentValue: paymentIntent.amount_received / 100, // USD → integer
                    paymentMethod: "stripe",
                    userUid: user.uid || "unknown",
                    firstName: user.firstName || "",
                    lastName: user.lastName || "",
                    userEmail: user.email || "",
                    transactionId: paymentIntent.id,
                    invoiceName: paymentIntent.metadata.invoiceName || "",
                    product: paymentIntent.metadata.productType || "unknown",
                    paymentType: paymentIntent.metadata.paymentType || "stripe",
                };

                console.log("Posting to n8n webhook:", payload);


                if (referredBy && !user.referralUsed) {
                    console.log("Referral detected → applying bonus for", { referredBy, userId });
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


                        if (refData.fcmToken) {
                            await this.sendNotification(
                                refData.fcmToken,
                                "Referral Bonus!",
                                "You earned bonus!"
                            );
                        }

                        console.log("ICCID found for the user in reffer case"  , iccid)
                        console.log("Found the iccid for refered by user " , refData.iccid)

                        if (iccidGiga) {
                            let euroAmount = this.usdToEur(5);
                            let reffererIccid = refData.iccid;
                            console.log("Adding balance to Referer :", { euroAmount });
                            await this.addSimtlvBalance(iccidGiga, user, euroAmount, io, simtlvGigaToken, "pending");
                            let simtlvRefToken = refData.existingUser ? await getMainToken() : await getToken();
                            console.log("Adding balance to Referered By  :", { euroAmount });
                            await this.addSimtlvBalance(reffererIccid, refData, euroAmount, io, simtlvRefToken, "pending");
                        }


                    }
                }

                await axios.post(
                    "https://n8n-sys.simtlv.co.il/webhook/21731742-dd24-461c-8c42-9cfafb5064f7",
                    payload,
                    { headers: { "Content-Type": "application/json" } }
                );

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


                    if (refData.fcmToken) {
                        await this.sendNotification(
                            refData.fcmToken,
                            "Referral Bonus!",
                            "You earned bonus!"
                        );
                    }

                    console.log("ICCID found for the user in reffer case"  , iccid)
                    console.log("Found the iccid for refered by user " , refData.iccid)

                    if (iccid) {
                        let euroAmount = this.usdToEur(5);
                        let reffererIccid = refData.iccid;
                        console.log("Adding balance to Referer :", { euroAmount });
                        await this.addSimtlvBalance(iccid, user, euroAmount, io, simtlvToken, "pending");
                        let simtlvRefToken = refData.existingUser ? await getMainToken() : await getToken();
                        console.log("Adding balance to Referered By  :", { euroAmount });
                        await this.addSimtlvBalance(reffererIccid, refData, euroAmount, io, simtlvRefToken, "pending");
                    }


                }
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
                isUsed: true,
                provider: "stripe",
                productType,
                paymentType,
            });

            await Transaction.update(
                { amount: usdAmount, product_type: productType, payment_type: paymentType },
                { where: { transaction_id: id } }
            );

            console.log("Transaction saved:", { userId, transactionId: id });

            console.log("===== Stripe transaction processed successfully =====", {
                userId,
                transactionId: id,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });

            const payload = {
                totalPaymentValue: paymentIntent.amount_received / 100, // USD → integer
                paymentMethod: "stripe",
                userUid: user.uid || "unknown",
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                userEmail: user.email || "",
                transactionId: paymentIntent.id,
                invoiceName: paymentIntent.metadata.invoiceName || "",
                product: paymentIntent.metadata.productType || "unknown",
                paymentType: paymentIntent.metadata.paymentType || "stripe",
            };

            console.log("Posting to n8n webhook:", payload);

            await axios.post(
                "https://n8n-sys.simtlv.co.il/webhook/21731742-dd24-461c-8c42-9cfafb5064f7",
                payload,
                { headers: { "Content-Type": "application/json" } }
            );


            console.log("===== Stripe webhook ended =====");
        } catch (err) {
            console.log("❌ saveStripeTransaction error", { error: err.message });
            await this.notifyAdminEmail("Stripe Webhook Failure", err.message);
        }
    }

    async saveLegacyStripeTransaction(paymentIntent) {
        const { metadata, id, amount_received, created } = paymentIntent;
        const userId = metadata.userId || "unknown";
        const productType = metadata.productType || "unknown";
        const paymentType = metadata.paymentType || "unknown";

        // only save basic tx, don’t re-credit balance
        await db.collection("transactions").add({
            userId,
            amount: amount_received / 100,
            transactionId: id,
            transactionTime: new Date(created * 1000),
            isUsed: false,
            provider: "stripe",
            productType,
            paymentType,
        });

        console.log("✅ Legacy transaction saved:", { userId, transactionId: id });
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
            // await this.addHistory(user.uid, {
            //     amount: (paymentIntent.amount_received / 100), // USD
            //     bonus: 0,
            //     currentBonus: null,
            //     dateTime: new Date().toISOString(),
            //     isPayAsyouGo: true,
            //     isTopup: false,
            //     paymentType: paymentIntent.metadata.paymentType,
            //     planName: paymentIntent.metadata.planName,
            //     referredBy: "",
            //     type: "GigaBoost Purchase",
            // });
            // console.log("History entry added for GigaBoost purchase");

            // Record transaction
            // await db.collection("transactions").add({
            //     userId: user.uid,
            //     amount: paymentIntent.amount_received / 100,
            //     transactionId: paymentIntent.id,
            //     transactionTime: new Date(paymentIntent.created * 1000),
            //     isUsed: false,
            //     provider: "stripe",
            //     productType: packageId,
            //     paymentType: paymentIntent.metadata.paymentType,
            // });
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

        this.delayedEmit(io, "payment_event_" + user.uid, {
            provider: "stripe",
            type: "payment_intent.succeeded",
            iccid: iccid,
            data: emitPayload
        });


        // io.emit("payment_event_" + user.uid, {
        //     provider: "stripe",
        //     type: "payment_intent.succeeded",
        //     iccid: iccid,
        //     data: emitPayload
        // });


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

    async createPayPalOrder({ amount, currency, userId, productType, paymentType , planName, planId , device_id }) {
        const accessToken = await getPayPalAccessToken();

        // ✅ Store metadata inside `custom_id` (same as your Cloud Function)
        const customId = JSON.stringify({ userId, productType, paymentType , planName, planId , flowVersion: "v2" , device_id});

        const response = await axios.post(
            `${process.env.PAYPAL_URL}/v2/checkout/orders`,
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
            `${process.env.PAYPAL_URL}/v2/checkout/orders/${orderId}/capture`,
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

            console.log("meta data" , metadata)

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

            const [result, createdRow] = await Transaction.findOrCreate({
                where: { transaction_id: transactionId },
                defaults: {
                    user_id: userId,
                    transaction_id: transactionId,
                    amount: amount,
                    provider: "payapl",
                    product_type: productType,
                    payment_type: paymentType
                },
            });

            if (!createdRow) {
                console.log("Duplicate transaction ignored:", id);
                return;
            }

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

                let iccid = user.iccid; // from app-registered-users
                let iccidGiga = user.iccid;
                console.log("Looking up GigaBoost plan:", planCode);

                let simtlvGigaToken = user.existingUser ? await getMainToken() : await getToken();
                console.log(simtlvGigaToken , "token before active ICCID");

                let emitPayload = null;

                // ------------------- Activate ICCID if not active -------------------
                if (user.isActive === false) {
                    console.log("SIM is not active → activating in GigaBoost PayPal flow");
                    simtlvGigaToken = await getMainToken();

                    const iccidResultGiga = await iccidService.activeIccid({
                        uid: userId,
                        amount: usdAmount,
                        paymentType,
                        transactionId,
                        simtlvToken: simtlvGigaToken,
                    });

                    if (!iccidGiga) {
                        iccidGiga = iccidResultGiga.iccid;
                        console.log("ICCID activation result:", iccidGiga);
                    }

                    const subscriberResult = await iccidService.getSingleSubscriber({
                        iccid: iccidResultGiga.iccid,
                        userData: user
                    });

                    emitPayload = {
                        status: { code: 200, msg: "Success", status },
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
                }

                // ------------------- Fetch Plan -------------------
                const planSnap = await db
                    .collection("gigaBoostPlans")
                    .where("plan_name", "==", planCode)
                    .limit(1)
                    .get();

                if (planSnap.empty) {
                    console.log("❌ GigaBoost plan not found in Firestore:", planCode);
                    await this.notifyAdminEmail("PayPal GigaBoost Failure", `Plan not found: ${planCode}`);
                    return;
                }

                const plan = planSnap.docs[0].data();
                const packageId = user.existingUser ? plan.id_simtlv : plan.id_simtlv_01;
                console.log("Plan resolved:", { planCode, planName: plan.plan_name, packageId });

                // ------------------- Apply Package -------------------
                try {
                    console.log("Calling affectPackageService with:", { iccidGiga, packageId });
                    await this.affectPackage(iccidGiga, packageId, user , data);
                    console.log("✅ GigaBoost package applied successfully");

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

                    await db.collection("transactions").add({
                        userId,
                        amount: usdAmount,
                        transactionId,
                        transactionTime: new Date(),
                        isUsed: true,
                        provider: "paypal",
                        productType: planCode,
                        paymentType,
                        status,
                        orderId,
                    });
                    await Transaction.update(
                        { amount: usdAmount, product_type: productType, payment_type: paymentType },
                        { where: { transaction_id: transactionId } }
                    );
                    console.log("Transaction recorded for GigaBoost PayPal:", { userId, transactionId });
                } catch (err) {
                    console.log("❌ Error applying GigaBoost package", { error: err.message, userId });
                    await this.notifyAdminEmail("PayPal GigaBoost Failure", err.message);
                }

                // ------------------- Default Emit Payload -------------------
                if (!emitPayload) {
                    emitPayload = {
                        status: { code: 200, msg: "Success", status },
                        getSingleSubscriber: {
                            subscriberId: null,
                            balance: null,
                            lastMcc: null,
                            sim: {
                                id: null,
                                subscriberId: null,
                                smdpServer: null,
                                activationCode: iccidGiga || "testiccid"
                            }
                        }
                    };
                }

                this.delayedEmit(io, "payment_event_" + user.uid, {
                    provider: "paypal",
                    type: "paypal.order.succeeded",
                    iccid: iccidGiga,
                    data: emitPayload
                });

                // ------------------- Referral Bonus Logic -------------------
                if (referredBy && !user.referralUsed) {
                    console.log("Referral detected → applying bonus for", { referredBy, userId });

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

                        if (refData.fcmToken) {
                            await this.sendNotification(
                                refData.fcmToken,
                                "Referral Bonus!",
                                "You earned bonus!"
                            );
                        }

                        if (iccidGiga) {
                            let euroAmount = this.usdToEur(5);
                            let referrerIccid = refData.iccid;

                            console.log("Adding balance to Referrer & Referee in SimTLV");
                            await this.addSimtlvBalance(iccidGiga, user, euroAmount, io, simtlvGigaToken, "pending");
                            let simtlvRefToken = refData.existingUser ? await getMainToken() : await getToken();
                            await this.addSimtlvBalance(referrerIccid, refData, euroAmount, io, simtlvRefToken, "pending");
                        }
                    }
                }

                // ------------------- Webhook -------------------
                const payload = {
                    totalPaymentValue: data.amount,
                    paymentMethod: "paypal",
                    userUid: user.uid || "unknown",
                    firstName: user.firstName || "",
                    lastName: user.lastName || "",
                    userEmail: user.email || "",
                    transactionId: data.id,
                    invoiceName: data.metadata.invoiceName || "",
                    product: data.metadata.productType || "unknown",
                    paymentType: data.metadata.paymentType || "paypal",
                };

                console.log("Posting to n8n webhook:", payload);

                await axios.post(
                    "https://n8n-sys.simtlv.co.il/webhook/21731742-dd24-461c-8c42-9cfafb5064f7",
                    payload,
                    { headers: { "Content-Type": "application/json" } }
                );

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
                isUsed: true,
                provider: "paypal",
                productType,
                paymentType,
                status,
                orderId,
            });

            await Transaction.update(
                { amount: usdAmount, product_type: productType, payment_type: paymentType },
                { where: { transaction_id: transactionId } }
            );

            console.log("Transaction saved:", { userId, transactionId });

            console.log("===== PayPal transaction processed successfully =====", {
                userId,
                transactionId,
                usdAmount,
                credited: euroAmount,
                bonus: bonusBalance,
            });


            const payload = {
                totalPaymentValue: data.amount, // USD → integer
                paymentMethod: "stripe",
                userUid: user.uid || "unknown",
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                userEmail: user.email || "",
                transactionId: data.id,
                invoiceName: data.metadata.invoiceName || "",
                product: data.metadata.productType || "unknown",
                paymentType: data.metadata.paymentType || "stripe",
            };

            console.log("Posting to n8n webhook:", payload);

            await axios.post(
                "https://n8n-sys.simtlv.co.il/webhook/21731742-dd24-461c-8c42-9cfafb5064f7",
                payload,
                { headers: { "Content-Type": "application/json" } }
            );

            console.log("===== PayPal transaction ended =====");
        } catch (err) {
            console.log("❌ savePayPalTransaction error", { error: err.message });
            await this.notifyAdminEmail("PayPal Webhook Failure", err.message);
        }
    }


}

module.exports = new PaymentService();
