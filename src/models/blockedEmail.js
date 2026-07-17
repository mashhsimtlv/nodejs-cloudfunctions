"use strict";

const { Model, DataTypes } = require("sequelize");

module.exports = class BlockedEmail extends Model {
    static init(sequelize) {
        return super.init(
            {
                id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
                // Substring matched against the user's email (lowercase):
                // a full address ("msjsiee3@gmail.com") or a domain ("@boticuk.com")
                pattern: { type: DataTypes.STRING(255), allowNull: false, unique: true },
                reason: { type: DataTypes.STRING(255), allowNull: true },
            },
            {
                sequelize,
                modelName: "BlockedEmail",
                tableName: "blocked_emails",
                timestamps: true,
            }
        );
    }
};
