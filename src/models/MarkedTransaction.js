"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = class MarkedTransaction extends Model {
    static init(sequelize) {
        return super.init(
            {
                transaction_id: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    unique: true, // Enforce uniqueness
                },
                email: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
            },
            {
                sequelize,
                modelName: "MarkedTransaction",
                tableName: "MarkedTransactions",
                timestamps: true,
            }
        );
    }
    static associate(models) {
        // You can add back-association here if needed
        // this.belongsTo(models.UnpaidTransaction, {
        //     foreignKey: "transaction_id",
        //     targetKey: "transaction_id",
        //     as: "unpaid_transaction"
        // });
    }
};
