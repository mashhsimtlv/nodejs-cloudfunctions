const express = require("express");
const router = express.Router();
const subscriberController = require("../controllers/subscriberController");

router.post("/modify-balance", subscriberController.modifyBalance);
router.post("/modify-status", subscriberController.modifyStatus);

module.exports = router;
