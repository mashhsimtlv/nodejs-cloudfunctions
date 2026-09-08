const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");

router.post("/send", notificationController.sendNotification);
router.post("/send-crm", notificationController.sendNotificationFromCRM);

module.exports = router;
