const subscriberService = require("../services/subscriberService");
const logger = require("../helpers/logger");
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;


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
