const axios = require("axios");
const admin = require('./../helpers/firebase')
const db = admin.firestore();

class IccidService {
    apiBase = "https://app-fb-simtlv.aridar-crm.com/api/firebase";

    async activeIccid({ uid, amount, paymentType, transactionId }) {
        try {
            const iccidSnap = await db
                .collection("iccids")
                .where("isAssigned", "==", false)
                .limit(1)
                .get();

            if (iccidSnap.empty) {
                return { status: "error", msg: "No ICCID available" };
            }

            const iccidDoc = iccidSnap.docs[0];
            const iccidValue = iccidDoc.data().iccid;

            // Mark ICCID as assigned
            await iccidDoc.ref.update({
                isAssigned: true,
                assignedTo: uid,
                assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Update user profile
            await db.collection("app-registered-users").doc(uid).update({
                isActive: true,
                iccid: iccidValue,
            });

            // Call backend API to activate subscriber
            const response = await axios.post(
                `${this.apiBase}/modify-subscriber-status`,
                { iccid: iccidValue }
            );

            console.log(response.data?.data , "server data")

            if (response.data?.data?.status?.msg === "OK") {
                return { status: "simActive", transactionId, iccid: iccidValue };
            } else {
                return { status: "error", transactionId };
            }
        } catch (err) {
            console.error("activeIccid Error:", err.message);
            return { status: "error", msg: err.message };
        }
    }
}

module.exports = new IccidService();
