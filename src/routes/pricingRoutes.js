const express = require("express");
const pricingController = require("../controllers/pricingController");

const router = express.Router();

router.post("/number-price", pricingController.getNumberPrice);
router.get("/number-price", pricingController.getNumberPrice);
router.post("/call-plan", pricingController.calculateCallPlan);

module.exports = router;
