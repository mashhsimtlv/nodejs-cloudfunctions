const { Model, DataTypes } = require("sequelize");

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
            }
        );
    }
}

module.exports = Transaction;