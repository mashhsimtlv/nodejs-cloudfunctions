const axios = require("axios");
const admin = require("./../helpers/firebase");
const db = admin.firestore();
const { User } = require("./../models");

// Helper functions (you probably have them in another service already)
const { getMainToken, getToken } = require("./../helpers/generalSettings");
// ⚠️ replace with your actual token / user service

class IccidService {
    apiBase = "https://app-fb-simtlv.aridar-crm.com/api/firebase";

    /**
     * Activate ICCID for a user
     */
    async activeIccid({ uid, amount, paymentType, transactionId, simtlvToken }) {
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

            console.log(simtlvToken  , 'sim tlv token')

            // Call Telco API to activate SIM
            const url = `https://ocs-api.telco-vision.com:7443/ocs-custo/main/v1?token=${simtlvToken}`;

            const requestData = {
                modifySubscriberStatus: {
                    subscriber: { iccid: iccidValue },
                    newStatus: "ACTIVE",
                },
            };

            await User.update(
                { iccid: iccidValue },     // fields to update
                { where: { uid } }         // condition
            );

            const response = await axios.post(url, requestData, {
                headers: { "Content-Type": "application/json" },
            });



            console.log(response.data , iccidValue, "server data");

            if (response.data?.status?.msg === "OK") {
                return { status: "simActive", transactionId, "iccid": iccidValue };
            } else {
                return { status: "error", transactionId };
            }
        } catch (err) {
            console.error("activeIccid Error:", err.message);
            return { status: "error", msg: err.message };
        }
    }

    /**
     * Get subscriber details (with SIM info)
     */
    async getSingleSubscriber({ iccid, userData , allowToggle = true }) {
        try {

            let simtlvToken;
            if (userData.existingUser) {
                console.log("getting main token for existing user");
                simtlvToken = await getMainToken();
            } else {
                console.log("getting user token for new user");
                simtlvToken = await getToken();
            }

            const url = `https://ocs-api.telco-vision.com:7443/ocs-custo/main/v1?token=${simtlvToken}`;

            const requestData = {
                getSingleSubscriber: {
                    iccid,
                    withSimInfo: true,
                    onlySubsInfo: true,
                },
            };

            // 3. Call API
            const response = await axios.post(url, requestData, {
                headers: { "Content-Type": "application/json" },
            });

            const apiStatus = response.data?.status;
            if (apiStatus?.code === 11 || apiStatus?.msg === "Subscriber not found") {
                let updatedUserData = null;
                if(userData.existingUser === false){
                    updatedUserData = { ...userData, existingUser: true };
                }else{
                    updatedUserData = { ...userData, existingUser: false };
                }
                await this.markUserAsExisting(userData);

                return this.getSingleSubscriber({ iccid, userData: updatedUserData , allowToggle: false });
            }

            console.log("check for balance add for iccid", response.data);


            const {
                sim: { id, subscriberId, smdpServer, activationCode },
                subscriberId: subscriberIdFromResponse,
                balance,
                lastMcc,
            } = response.data.getSingleSubscriber;

            // 4. Return structured result
            return {
                status: { code: 0, msg: "OK" },
                getSingleSubscriber: {
                    sim: {
                        id,
                        subscriberId,
                        smdpServer,
                        activationCode,
                    },
                    subscriberId: subscriberIdFromResponse,
                    balance,
                    lastMcc,
                },
            };
        } catch (err) {
            console.error("getSingleSubscriber Error:", err.message);
            return { status: "error", msg: err.message };
        }
    }
    async markUserAsExisting(userData) {
        const uid = userData?.uid || userData?.userId;
        if (!uid) return;

        try {
            const userRef = admin.firestore().collection("app-registered-users").doc(uid);
            await userRef.set({ existingUser: true }, { merge: true });
        } catch (err) {
            console.error("Failed to update Firestore existingUser flag:", err.message);
        }

        try {
            await User.update(
                { existing_user: true },
                { where: { uid } }
            );
        } catch (err) {
            console.error("Failed to update MySQL existing_user flag:", err.message);
        }
    }
}



module.exports = new IccidService();
