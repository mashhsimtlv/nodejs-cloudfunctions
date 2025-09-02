const axios = require("axios");
require("dotenv").config();

async function getPayPalAccessToken() {
    const response = await axios({
        method: "post",
        url: "https://api.sandbox.paypal.com/v1/oauth2/token",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        auth: {
            username: process.env.PAYPAL_CLIENT_ID,
            password: process.env.PAYPAL_SECRET,
        },
        data: "grant_type=client_credentials",
    });
    return response.data.access_token;
}

module.exports = { getPayPalAccessToken };
