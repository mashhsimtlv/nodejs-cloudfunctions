const axios = require("axios");
require("dotenv").config();

async function getPayPalAccessToken(options = {}) {
    const baseUrl = options.baseUrl || process.env.PAYPAL_URL;
    const clientId = options.clientId || process.env.PAYPAL_CLIENT_ID;
    const secret = options.secret || process.env.PAYPAL_SECRET;

    if (!baseUrl || !clientId || !secret) {
        throw new Error("PayPal credentials or base URL missing");
    }

    const response = await axios({
        method: "post",
        url: `${baseUrl}/v1/oauth2/token`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        auth: {
            username: clientId,
            password: secret,
        },
        data: "grant_type=client_credentials",
    });
    return response.data.access_token;
}

module.exports = { getPayPalAccessToken };
