const express = require("express");
const pricingController = require("../controllers/pricingController");

const router = express.Router();

router.post("/call-plan", pricingController.calculateCallPlan);

module.exports = router;
