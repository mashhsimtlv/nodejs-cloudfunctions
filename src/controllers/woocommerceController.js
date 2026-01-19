const subscriberService = require("../services/subscriberService");
const logger = require("../helpers/logger");
const axios = require("axios");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const { Op } = require("sequelize");
const {
    ContactTag,
    ContactTagStatus,
    ContactTagComment,
    GooglePhoneOrder,
    sequelize,
} = require("../models");

// Normalize webhook payloads so we can store and emit the same shape consistently
const buildContactTagRecord = ({
    body,
    contact,
    assignee,
    incomingTags,
    mentionedUserIds,
    mentionedUserEmails,
}) => {
    const tagsJson = incomingTags.length ? JSON.stringify(incomingTags) : null;
    const mentionedIdsJson = mentionedUserIds.length
        ? JSON.stringify(mentionedUserIds)
        : null;
    const mentionedEmailsJson = mentionedUserEmails.length
        ? JSON.stringify(mentionedUserEmails)
        : null;

    return {
        eventType: body?.event_type ?? null,
        eventId: body?.event_id ?? null,
        contactId: contact?.id ?? null,
        contactFirstName: contact?.firstName ?? null,
        contactLastName: contact?.lastName ?? null,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
        contactCountryCode: contact?.countryCode ?? null,
        contactStatus: contact?.status ?? null,
        assigneeId: assignee?.id ?? null,
        assigneeEmail: assignee?.email ?? null,
        assigneeFirstName: assignee?.firstName ?? null,
        assigneeLastName: assignee?.lastName ?? null,
        commentText: body?.text ?? null,
        tags: tagsJson,
        mentionedUserIds: mentionedIdsJson,
        mentionedUserEmails: mentionedEmailsJson,
        rawPayload: JSON.stringify(body),
    };
};

const emitContactTagEvent = (io, tagData, targetUserIds = []) => {
    if (!io || !targetUserIds.length) {
        return;
    }

    const timestamp = new Date();
    const emitPayload = {
        ...tagData,
        statuses: [],
        comments: [],
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    targetUserIds.forEach((userId) => {
        const userKey = String(userId || "").trim();
        if (!userKey) return;
        io.emit(`contact_tags_update_${userKey}`, {
            success: true,
            data: emitPayload,
        });
    });
};

const extractRefCode = (message) => {
    if (!message || typeof message !== "string") {
        return null;
    }
    const match = message.match(/\[Ref Code:\s*([A-Za-z0-9_-]+)\s*\]/i);
    return match ? match[1] : null;
};

const fetchGclidRecord = async (code) => {
    if (!code) return null;
    const [rows] = await sequelize.query(
        "SELECT * FROM gclid_codes WHERE code = ? LIMIT 1",
        { replacements: [code] }
    );
    console.log(rows , rows[0] , "sdfsdfdsf");
    return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const getCurrentDateTimeParts = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return { date, time };
};

const normalizeLeadPayload = (source, phone) => {
    const { date, time } = getCurrentDateTimeParts();
    return {
        maskyoo: "respondio",
        cli: phone ?? source?.phone ?? source?.phone_number ?? source?.cli ?? null,
        callDate: date,
        callTime: time,
        callStatus: source?.call_status ?? source?.callstatus ?? null,
        callDuration: source?.call_duration ?? source?.callduration ?? null,
        gclid: source?.gclid ?? null,
        pageLocation: source?.page_location ?? null,
        status: null,
    };
};

const postJson = async (url, payload, headers = {}) => {
    const response = await axios.post(url, payload, { headers });
    return response.status;
};

const fetchCustomerByPhone = async (phone) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey || !phone) {
        return null;
    }
    const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/customers?phone=eq.${encodeURIComponent(
        phone
    )}&limit=1`;
    const response = await axios.get(endpoint, {
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
        },
    });
    return Array.isArray(response.data) && response.data.length
        ? response.data[0]
        : null;
};


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
    const body = req.body;

    // console.log(" Webhook Received:", JSON.stringify(body, null, 2));

    try {
        const io = req.app.get("io");
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

        const recordPayload = buildContactTagRecord({
            body,
            contact,
            assignee,
            incomingTags,
            mentionedUserIds,
            mentionedUserEmails,
        });

        const targetUserIds = new Set([
            assignee?.id ? String(assignee.id) : null,
            ...mentionedUserIds,
        ]);

        // --- CONDITION: Only save if mentionedUserIds is present ---
        if (mentionedUserIds.length > 0) {
            console.log("💾 Saving webhook because mentionedUserIds exist:", mentionedUserIds);

            emitContactTagEvent(io, recordPayload, Array.from(targetUserIds).filter(Boolean));
            await ContactTag.create(recordPayload);
        } else {
            // console.log("⏭ Skipped saving (NO mentionedUserIds)");
        }

        // ALWAYS respond 200 OK
        return res.status(200).json({ success: true });

    } catch (err) {
        // Only print, do not send 500
        console.error("❌ Webhook error (ignored):", err.message);

        // Still return 200 OK
        return res.status(200).json({ success: false });
    }
};

exports.getAllConversation = async (req, res) => {
    const body = req.body;

    console.log(" Webhook Received:", JSON.stringify(body, null, 2));

    try {
        const payload = {
            googleId: body?.contact?.id ? String(body.contact.id) : null,
            phone: body?.contact?.phone ? String(body.contact.phone) : null,
            webhookData: JSON.stringify(body),
            type: "respond io",
            orderNumber:
                body?.order_number ??
                body?.orderNumber ??
                body?.order?.number ??
                body?.order?.id ??
                null,
            orderValue:
                body?.order_value ??
                body?.orderValue ??
                body?.order?.total ??
                body?.order?.total_price ??
                null,
        };

        await GooglePhoneOrder.create(payload);

        const refCode = extractRefCode(body?.conversation?.firstIncomingMessage);
        if (!refCode) {
            return res.status(200).json({ success: true });
        }

        const gclidRecord = await fetchGclidRecord(refCode);
        if (!gclidRecord) {
            console.log("No gclid_codes entry found for ref code:", refCode);
            return res.status(200).json({ success: true });
        }

        const leadPhone = gclidRecord?.phone ?? gclidRecord?.phone_number ?? null;
        if (!leadPhone || !gclidRecord?.gclid) {
            console.log("Missing required lead fields:", {
                phone: leadPhone,
                gclid: gclidRecord?.gclid ?? null,
            });
            return res.status(200).json({ success: true });
        }

        const baseUrl = "https://app-link.simtlv.co.il";
        if (!baseUrl) {
            console.warn("BASE_URL not set; skipping transaction API call.");
            return res.status(200).json({ success: true });
        }

        const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/transaction/store-leads-orders`;
        const leadPayload = normalizeLeadPayload(gclidRecord, leadPhone);
        try {
            const statusCode = await postJson(endpoint, leadPayload);
            if (!(statusCode >= 200 && statusCode < 300)) {
                console.error("Transaction API returned non-2xx:", statusCode);
            }
        } catch (error) {
            console.error("Failed to forward to transaction API:", error);
        }

        // ALWAYS respond 200 OK
        return res.status(200).json({ success: true });

    } catch (err) {
        // Only print, do not send 500
        console.error("❌ Webhook error (ignored):", err.message);

        // Still return 200 OK
        return res.status(200).json({ success: false });
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
exports.setTagsCompletedAt = async (req, res) => {
    try {
        const {tagId } = req.body;

        if (!tagId) {
            return res.status(400).json({ error: "tagId param is required" });
        }


        const tag = await ContactTag.findByPk(tagId);
        if (!tag) {
            return res.status(404).json({ error: "Tag not found" });
        }

        const record = await tag.update({
            completedAt: new Date(),
            status: 'completed'
        })

        return res.status(201).json({ success: true, data: record });
    } catch (err) {
        logger.error("add tag comment failed", { error: err.message });
        res.status(500).json({ error: err.message });
    }
};
