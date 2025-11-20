const express = require("express");
const router = express.Router();
const woocomerceController = require("../controllers/woocommerceController");

router.get("/create-order-generate-payment-link", woocomerceController.createOrderPaymentLink);

router.post('/get-all-tags' , woocomerceController.getAllTags);
router.get("/tags", woocomerceController.listTags);
router.post("/tags/:tagId/status", woocomerceController.setTagStatus);
router.post("/tags/:tagId/comments", woocomerceController.addTagComment);
router.post("/tags/completed_at" , woocomerceController.setTagsCompletedAt);
// router.get('/send-message-with-revuity' , woocomerceController.sendSMSRevuity);

module.exports = router;
