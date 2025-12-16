const pricingService = require("../services/pricingService");

exports.calculateCallPlan = async (req, res) => {
    try {
        const payload = {
            startTime: req.body.startTime ?? req.body.start_time,
            endTime: req.body.endTime ?? req.body.end_time,
            userId: req.body.userId ?? req.body.user_id,
            country: req.body.country,
            planType: req.body.planType ?? req.body.plan_type ?? "incoming_outgoing",
            minutesOption:
                Number(req.body.minutesOption ?? req.body.minutes_option ?? req.body.minutes) || 200,
        };

        const data = await pricingService.calculateCallPlan(payload);
        return res.status(201).json({ success: true, data });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
};
