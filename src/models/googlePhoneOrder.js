const { Model, DataTypes } = require("sequelize");

class GooglePhoneOrder extends Model {
    static init(sequelize) {
        return super.init(
            {
                googleId: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                },
                phone: {
                    type: DataTypes.STRING(50),
                    allowNull: true,
                },
                webhookData: {
                    type: DataTypes.TEXT("long"),
                    allowNull: true,
                },
                type: {
                    type: DataTypes.STRING(50),
                    allowNull: false,
                    defaultValue: "respond io",
                },
                orderNumber: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                },
                orderValue: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: true,
                },
            },
            {
                sequelize,
                modelName: "GooglePhoneOrder",
                tableName: "google_phone_orders",
                timestamps: true,
            }
        );
    }
}

module.exports = GooglePhoneOrder;
