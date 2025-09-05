const express = require("express");
const router = express.Router();
const woocomerceController = require("../controllers/woocommerceController");

router.get("/create-order-generate-payment-link", woocomerceController.createOrderPaymentLink);

module.exports = router;
