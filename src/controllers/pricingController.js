const pricingService = require("../services/pricingService");

exports.calculateCallPlan = async (req, res) => {
    try {
        const payload = {
            startTime: req.body.startTime ?? req.body.start_time,
            endTime: req.body.endTime ?? req.body.end_time,
            userId: req.body.userId ?? req.body.user_id,
            country: req.body.country,
            planType: req.body.planType ?? req.body.plan_type,
            minutesOption: (() => {
                const raw = req.body.minutesOption ?? req.body.minutes_option ?? req.body.minutes;
                return raw == null ? undefined : Number(raw);
            })(),
        };

        const { quotes, selectedQuote } = await pricingService.calculateCallPlan(payload);

        const toStr = (val) => (val == null ? null : String(Number(val.toFixed ? val.toFixed(2) : val)));

        const incoming200 = quotes?.incoming?.[200];
        const outgoing200 = quotes?.incoming_outgoing?.[200];
        const outgoing500 = quotes?.incoming_outgoing?.[500];
        const outgoing1000 = quotes?.incoming_outgoing?.[1000];

        const data = {
            incoming: incoming200
                ? {
                    base_price: toStr(incoming200.basePrice),
                    extra_price: toStr(incoming200.extraPrice),
                    extra_block: toStr(incoming200.extraBlocks),
                    total_price: toStr(incoming200.totalPrice),
                }
                : null,
            incoming_outgoing: outgoing200
                ? {
                    base_price: toStr(outgoing200.basePrice),
                    extra_price: toStr(outgoing200.extraPrice),
                    extra_block: toStr(outgoing200.extraBlocks),
                    total_price: toStr(outgoing200.totalPrice),
                    minutes_500: outgoing500 ? toStr(outgoing500.totalPrice) : null,
                    minutes_1000: outgoing1000 ? toStr(outgoing1000.totalPrice) : null,
                }
                : null,
            selectedQuote,
        };

        return res.status(201).json({ success: true, data });
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
};
