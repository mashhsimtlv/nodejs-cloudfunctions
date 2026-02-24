"use strict";

const { Model, DataTypes } = require("sequelize");

module.exports = class UnpaidTransaction extends Model {
    static init(sequelize) {
        return super.init(
            {
                id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
                user_id: { type: DataTypes.STRING(128), allowNull: true },
                transaction_id: { type: DataTypes.STRING(255), allowNull: false },
                user_email: { type: DataTypes.STRING(255), allowNull: true },
                status: { type: DataTypes.STRING(64), allowNull: false },
                page_source: { type: DataTypes.STRING(255), allowNull: true },
                amount: { type: DataTypes.STRING(255), allowNull: true },
            },
            {
                sequelize,
                modelName: "UnpaidTransaction",
                tableName: "unpaid_transactions",
                timestamps: true,
            }
        );
    }
    static associate(models) {
        // Commented out as User model appears to be Mongoose, not Sequelize
        // this.belongsTo(models.User, {
        //     foreignKey: "user_id",
        //     targetKey: "uid",
        //     as: "user",
        // });
        this.hasOne(models.MarkedTransaction, {
            foreignKey: "transaction_id",
            sourceKey: "transaction_id",
            as: "marked_info"
        });
    }
};
