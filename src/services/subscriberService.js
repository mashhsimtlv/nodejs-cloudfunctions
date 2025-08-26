const axios = require("axios");

class SubscriberService {
    /**
     * Modify subscriber balance
     */
    async modifyBalance({ subscriberId, amount, description, authorization }) {
        if (!subscriberId || amount == null || !description) {
            throw new Error("Missing required parameters: subscriberId, amount, description");
        }
        if (!authorization || !authorization.startsWith("Bearer ")) {
            throw new Error("Missing or invalid Authorization header");
        }

        const response = await axios.post(
            "https://app-fb-simtlv.aridar-crm.com/api/firebase/modify-subscriber-balance",
            { subscriberId, amount, description },
            { headers: { Authorization: authorization } }
        );

        return response.data;
    }

    /**
     * Modify subscriber status (active/inactive by ICCID)
     */
    async modifyStatus({ iccid, authorization }) {
        if (!iccid) {
            throw new Error("Missing required parameter: iccid");
        }
        if (!authorization || !authorization.startsWith("Bearer ")) {
            throw new Error("Missing or invalid Authorization header");
        }

        const response = await axios.post(
            "https://app-fb-simtlv.aridar-crm.com/api/firebase/modify-subscriber-status",
            { iccid },
            { headers: { Authorization: authorization } }
        );

        return response.data;
    }
}

module.exports = new SubscriberService();
