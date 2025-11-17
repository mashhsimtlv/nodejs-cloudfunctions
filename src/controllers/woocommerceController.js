const subscriberService = require("../services/subscriberService");
const logger = require("../helpers/logger");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const { Op } = require("sequelize");
const {
    ContactTag,
    ContactTagStatus,
    ContactTagComment,
} = require("../models");


const api = new WooCommerceRestApi({
    url: "https://simtlv.co.il",   // your WooCommerce site
    consumerKey: "ck_00f65b27dd56e3617b0fa7e64b756a3c2cadf6dd",
    consumerSecret: "cs_42153016d7425aa4f139582800d97cd09db03823",
    version: "wc/v3"
});

exports.createOrderPaymentLink = async (req, res) => {
    try {
        const productName = "Special Product";
        const sku = "SPECIAL123";
        let productId;

        // 1. Check if product exists
        const products = await api.get("products", { sku });
        if (products.data.length > 0) {
            productId = products.data[0].id;
            console.log("✅ Product exists:", productId);
        } else {
            // 2. Create product with price 10
            const newProd = await api.post("products", {
                name: productName,
                sku,
                regular_price: "10.00"
            });
            productId = newProd.data.id;
            console.log("🆕 Product created:", productId);
        }

        // 3. Create order with line item price 0
        const order = await api.post("orders", {
            payment_method: "", // leave empty → pending
            payment_method_title: "Pending",
            set_paid: false,
            status: "pending",
            billing: {
                first_name: "John",
                last_name: "Doe",
                address_1: "123 Street",
                city: "Tel Aviv",
                country: "IL",
                email: "john@example.com",
                phone: "123456789"
            },
            line_items: [
                {
                    product_id: productId,
                    quantity: 1,
                    subtotal: "1.00",
                    total: "1.00"
                }
            ]
        });

        const orderId = order.data.id;
        console.log("📦 Order created:", orderId);

        // 4. Generate payment URL
        const paymentUrl = `https://simtlv.co.il/checkout/order-pay/${orderId}/?pay_for_order=true&key=${order.data.order_key}`;
        console.log("💳 Payment URL:", paymentUrl);

        return paymentUrl;

    } catch (err) {
        logger.error("Modify status failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};
exports.getAllTags = async (req, res) => {
    try {
        const body = req.body;

        console.log("🔔 Webhook Received:", JSON.stringify(body, null, 2));

        const toStringOrNull = (value) =>
            value === null || value === undefined || value === "" ? null : String(value);

        const contact = body?.contact ?? {};
        const assignee = contact?.assignee ?? {};
        const incomingTagsRaw =
            (Array.isArray(contact?.tags) && contact.tags) ||
            (Array.isArray(body?.tags) && body.tags) ||
            [];
        const incomingTags = Array.isArray(incomingTagsRaw) ? incomingTagsRaw : [];

        const mentionedUserIds = Array.isArray(body?.mentionedUserIds)
            ? body.mentionedUserIds.map((id) => String(id))
            : [];
        const mentionedUserEmails = Array.isArray(body?.mentionedUserEmails)
            ? body.mentionedUserEmails.map((email) => String(email))
            : [];

        const savedTagRecord = await ContactTag.create({
            eventType: body?.event_type ?? null,
            eventId: body?.event_id ?? null,
            contactId: toStringOrNull(contact?.id),
            contactFirstName: contact?.firstName ?? null,
            contactLastName: contact?.lastName ?? null,
            contactEmail: contact?.email ?? null,
            contactPhone: contact?.phone ?? null,
            contactCountryCode: contact?.countryCode ?? null,
            contactStatus: contact?.status ?? null,
            assigneeId: toStringOrNull(assignee?.id),
            assigneeEmail: assignee?.email ?? null,
            assigneeFirstName: assignee?.firstName ?? null,
            assigneeLastName: assignee?.lastName ?? null,
            commentText: body?.text ?? null,
            tags: incomingTags.length ? JSON.stringify(incomingTags) : null,
            mentionedUserIds: mentionedUserIds.length
                ? JSON.stringify(mentionedUserIds)
                : null,
            mentionedUserEmails: mentionedUserEmails.length
                ? JSON.stringify(mentionedUserEmails)
                : null,
            rawPayload: JSON.stringify(body),
        });

        return res
            .status(201)
            .json({ success: true, message: "Webhook stored", id: savedTagRecord.id });
    } catch (err) {
        logger.error("all tags issues", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.listTags = async (req, res) => {
    try {
        const userIdRaw = req.query.userId;
        const limitRaw = parseInt(req.query.limit, 10);
        const limit = Number.isNaN(limitRaw) ? 40 : Math.min(Math.max(limitRaw, 1), 100);

        const whereClause = {};
        if (userIdRaw) {
            const userId = String(userIdRaw);
            const mentionNeedle = `"${userId}"`;
            const mentionPresenceCondition = {
                [Op.and]: [
                    { mentionedUserIds: { [Op.not]: null } },
                    { mentionedUserIds: { [Op.ne]: "[]" } },
                ],
            };
            whereClause[Op.or] = [
                { assigneeId: userId },
                { mentionedUserIds: { [Op.like]: `%${mentionNeedle}%` } },
                mentionPresenceCondition,
            ];
        }

        const tags = await ContactTag.findAll({
            where: whereClause,
            order: [["createdAt", "DESC"]],
            limit,
            include: [
                {
                    model: ContactTagStatus,
                    as: "statuses",
                },
                {
                    model: ContactTagComment,
                    as: "comments",
                },
            ],
        });

        return res.json({ success: true, data: tags });
    } catch (err) {
        logger.error("list tags failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.setTagStatus = async (req, res) => {
    try {
        const { tagId } = req.params;
        const { userId, status, entertainedByUserId } = req.body;

        if (!tagId) {
            return res.status(400).json({ error: "tagId param is required" });
        }
        if (!userId || !status) {
            return res
                .status(400)
                .json({ error: "userId and status are required in body" });
        }

        const tag = await ContactTag.findByPk(tagId);
        if (!tag) {
            return res.status(404).json({ error: "Tag not found" });
        }

        const payload = {
            contactTagId: tag.id,
            userId: String(userId),
            status,
            entertainedByUserId: entertainedByUserId
                ? String(entertainedByUserId)
                : String(userId),
        };

        const existing = await ContactTagStatus.findOne({
            where: { contactTagId: tag.id, userId: payload.userId },
        });

        let record;
        if (existing) {
            await existing.update(payload);
            record = existing;
        } else {
            record = await ContactTagStatus.create(payload);
        }

        return res.json({ success: true, data: record });
    } catch (err) {
        logger.error("set tag status failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};

exports.addTagComment = async (req, res) => {
    try {
        const { tagId } = req.params;
        const { addedByUserId, comment, taggedUserId } = req.body;

        if (!tagId) {
            return res.status(400).json({ error: "tagId param is required" });
        }
        if (!addedByUserId || !comment) {
            return res
                .status(400)
                .json({ error: "addedByUserId and comment are required" });
        }

        const tag = await ContactTag.findByPk(tagId);
        if (!tag) {
            return res.status(404).json({ error: "Tag not found" });
        }

        const record = await ContactTagComment.create({
            contactTagId: tag.id,
            addedByUserId: String(addedByUserId),
            comment,
            taggedUserId: taggedUserId ? String(taggedUserId) : null,
        });

        return res.status(201).json({ success: true, data: record });
    } catch (err) {
        logger.error("add tag comment failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};
