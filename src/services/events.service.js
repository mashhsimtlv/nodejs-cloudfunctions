const axios = require("axios");

const API_BASE_URL = process.env.EVENTS_API_URL || "http://localhost:5000/events";

// Payment Intent Created
const paymentIntentCreated = async (payload) => {
    try {
        const { data } = await axios.post(`${API_BASE_URL}/payment-intent-created`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

// Stripe Succeeded
const stripeSucceeded = async (payload) => {
    try {
        const { data } = await axios.post(`${API_BASE_URL}/stripe-succeeded`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

// Paypal Succeeded
const paypalSucceeded = async (payload) => {
    try {
        const { data } = await axios.post(`${API_BASE_URL}/paypal-succeeded`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

// GigaBoost History
const gigaboostHistory = async (payload) => {
    try {
        const { data } = await axios.post(`${API_BASE_URL}/gigaboost-history`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

// Transaction Created
const transactionCreated = async (payload) => {
    try {
        const { data } = await axios.post(`https://app-link.simtlv.co.il/api/transaction/save-transaction`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

// Package Activated
const packageActivated = async (payload) => {
    try {
        const { data } = await axios.post(`${API_BASE_URL}/package-activated`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

// Balance Added
const balanceAdded = async (payload) => {
    try {
        const { data } = await axios.post(`${API_BASE_URL}/balance-added`, payload);
        return data;
    } catch (err) {
        throw err.response?.data || err.message;
    }
};

module.exports = {
    paymentIntentCreated,
    stripeSucceeded,
    paypalSucceeded,
    gigaboostHistory,
    transactionCreated,
    packageActivated,
    balanceAdded,
};
