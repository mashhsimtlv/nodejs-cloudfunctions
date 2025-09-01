const express = require("express");
const router = express.Router();
const subscriberController = require("../controllers/subscriberController");
const logger = require("../helpers/logger");

router.post("/modify-balance", subscriberController.modifyBalance);
router.post("/modify-status", subscriberController.modifyStatus);

router.get('/test' ,  async (req, res) => {
    logger.info("ICCID activation attempted after payment", {
        user_id: "33434",
        transactionId: "sdfsdfdsf",
        amount: "sdfsfsdf",
    });
})

module.exports = router;
