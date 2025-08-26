const stripe = require("../config/stripe");
const { db, Timestamp } = require("../config/db");
const { getPayPalAccessToken } = require("../config/paypal");
const axios = require("axios");

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
     * Save Stripe Transaction to Firestore
     */
    async saveStripeTransaction(paymentIntent) {
        const { metadata, id, amount_received, created } = paymentIntent;
        await db.collection("transactions").add({
            userId: metadata.userId || "unknown",
            amount: amount_received / 100,
            transactionId: id,
            transactionTime: Timestamp.fromMillis(created * 1000),
            isUsed: false,
            provider: "stripe",
            productType: metadata.productType || "unknown",
            paymentType: metadata.paymentType || "unknown",
        });
    }

    /**
     * Create PayPal Order
     */
    async createPayPalOrder({ amount, currency, userId, productType, paymentType }) {
        const token = await getPayPalAccessToken();

        const response = await axios.post(
            "https://api-m.paypal.com/v2/checkout/orders",
            {
                intent: "CAPTURE",
                purchase_units: [
                    {
                        amount: { currency_code: currency || "USD", value: amount },
                        custom_id: JSON.stringify({ uid: userId, productType, paymentType }),
                    },
                ],
                application_context: {
                    return_url: "https://simtlv-esim.web.app/payment-success.html",
                    cancel_url: "https://simtlv-esim.web.app/payment-cancel.html",
                },
            },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return response.data;
    }

    /**
     * Capture PayPal Order
     */
    async capturePayPalOrder(orderId) {
        const token = await getPayPalAccessToken();

        const response = await axios.post(
            `https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return response.data;
    }

    /**
     * Verify Transaction in Firestore
     */
    async verifyTransaction({ transactionId, amount, userId }) {
        const querySnapshot = await db
            .collection("transactions")
            .where("transactionId", "==", transactionId)
            .where("amount", "==", amount)
            .where("userId", "==", userId)
            .where("isUsed", "==", false)
            .get();

        if (querySnapshot.empty) return null;
        return querySnapshot;
    }

    /**
     * Mark Transaction as Used
     */
    async markTransactionUsed(querySnapshot) {
        const batch = db.batch();
        querySnapshot.forEach((doc) => {
            batch.update(doc.ref, { isUsed: true });
        });
        await batch.commit();
    }
}

module.exports = new PaymentService();
