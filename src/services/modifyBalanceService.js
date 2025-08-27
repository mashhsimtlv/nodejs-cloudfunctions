const axios = require("axios");
const { getUserByUid, getMainToken, getToken } = require("../helpers/generalSettings");

// 🔹 Service to modify subscriber balance
const modifyBalanceService = async (data, user) => {
    const { subscriberId, amount, description } = data;
    const userData = await getUserByUid(user.uid);

    let simtlvToken = null;
    if (userData.existingUser) {
        simtlvToken = await getMainToken();
    } else {
        simtlvToken = await getToken();
    }

    const url = `${process.env.TELCOM_URL}ocs-custo/main/v1?token=${simtlvToken}`;

    const requestData = {
        modifySubscriberBalance: {
            subscriber: { subscriberId },
            amount,
            description: description || "Top-up from Stripe",
        },
    };

    const response = await axios.post(url, requestData, {
        headers: { "Content-Type": "application/json" },
    });

    return response.data;
};

module.exports = { modifyBalanceService };
