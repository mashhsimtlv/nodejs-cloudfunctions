const { admin, db } = require("../config/db");

class NotificationService {
    /**
     * Send a single notification
     */
    async sendNotification({ token, title, body, data }) {
        if (!token || !title || !body) {
            throw new Error("Missing required fields: token, title, body");
        }

        const message = {
            token,
            notification: { title, body },
            data: data || {},
        };

        return await admin.messaging().send(message);
    }

    /**
     * Send notification to multiple users from CRM
     * (emails → lookup users → FCM tokens → send multicast)
     */
    async sendNotificationFromCRM({ emails, title, body, route, redeemCode, amount }) {
        if (!emails || !title || !body || !route) {
            throw new Error("Missing required fields (emails, title, body, route)");
        }

        // Firestore 'in' operator supports max 30 values
        if (emails.length > 30) {
            throw new Error("Maximum 30 emails are allowed at once.");
        }

        const usersSnapshot = await db
            .collection("app-registered-users")
            .where("email", "in", emails)
            .get();

        if (usersSnapshot.empty) {
            return { success: false, message: "No users found with the provided emails." };
        }

        const validTokens = [];
        usersSnapshot.forEach((doc) => {
            const user = doc.data();
            if (user.isNotificationEnabled && user.isLoggedin && user.fcmToken) {
                validTokens.push(user.fcmToken);
            }
        });

        if (validTokens.length === 0) {
            return { success: false, message: "No valid FCM tokens found for the provided emails." };
        }

        // Build payload
        const dataPayload = { route };
        if (route === "redeem" && redeemCode) dataPayload.redeemCode = redeemCode;
        if (route === "purchaseSummary" && amount !== undefined) dataPayload.amount = amount.toString();

        const message = {
            notification: { title, body },
            data: dataPayload,
            tokens: validTokens,
        };

        return await admin.messaging().sendEachForMulticast(message);
    }
}

module.exports = new NotificationService();
