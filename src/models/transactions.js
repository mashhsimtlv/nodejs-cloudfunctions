const { Model, DataTypes } = require("sequelize");
const eventsAPI = require("../services/events.service"); // ✅ Import your events service

class Transaction extends Model {
    static init(sequelize) {
        return super.init(
            {
                user_id: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                },
                transaction_id: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
                    unique: true, // ensure idempotency
                },
                amount: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: false,
                },
                currency: {
                    type: DataTypes.STRING(10),
                    allowNull: false,
                    defaultValue: "USD",
                },
                provider: {
                    type: DataTypes.ENUM("stripe", "paypal"),
                    allowNull: false,
                },
                product_type: {
                    type: DataTypes.STRING(50),
                    allowNull: true,
                },
                payment_type: {
                    type: DataTypes.STRING(50),
                    allowNull: true,
                },
                isUsed: {
                    type: DataTypes.BOOLEAN,
                    defaultValue: true,
                },
                transactionTime: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
            },
            {
                sequelize,
                modelName: "Transaction",
                tableName: "transactions",
                timestamps: true, // adds createdAt / updatedAt
                // hooks: {
                //     // ✅ Automatically trigger when new record is created
                //     async afterCreate(transaction) {
                //         try {
                //             await eventsAPI.transactionCreated({
                //                 provider: transaction.provider,
                //                 transactionId: transaction.transaction_id,
                //                 userId: transaction.user_id,
                //                 amount: transaction.amount,
                //                 currency: transaction.currency,
                //                 productType: transaction.product_type ?? "Test",
                //                 paymentType: transaction.payment_type ?? "Test",
                //                 createdAt: transaction.createdAt,
                //                 status: "completed",
                //                 eventType: "created",
                //             });
                //             console.log("✅ [Event] Transaction created event sent successfully:", transaction.transaction_id);
                //         } catch (err) {
                //             console.error("❌ [Event] Failed to send transactionCreated event:", err.message);
                //         }
                //     },
                //
                //     // ✅ Automatically trigger when existing record is updated
                //     async afterUpdate(transaction) {
                //         try {
                //             await eventsAPI.transactionCreated({
                //                 provider: transaction.provider,
                //                 transactionId: transaction.transaction_id,
                //                 userId: transaction.user_id,
                //                 amount: transaction.amount,
                //                 currency: transaction.currency,
                //                 productType: transaction.product_type ?? "Test",
                //                 paymentType: transaction.payment_type ?? "Test",
                //                 updatedAt: transaction.updatedAt,
                //                 status: transaction.status ?? "updated",
                //                 eventType: "updated",
                //             });
                //             console.log("♻️ [Event] Transaction updated event sent successfully:", transaction.transaction_id);
                //         } catch (err) {
                //             console.error("❌ [Event] Failed to send transactionUpdated event:", err.message);
                //         }
                //     },
                // },
            }
        );
    }
}

module.exports = Transaction;
