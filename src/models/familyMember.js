"use strict";

const { Model, DataTypes } = require("sequelize");

// FamilyMember — links a child/member Firebase user under a parent Firebase user.
// The same member_uid may be linked under multiple parent_uids (a SIM/user can
// belong to more than one family), but each (parent_uid, member_uid) pair is unique.
module.exports = class FamilyMember extends Model {
    static init(sequelize) {
        return super.init(
            {
                parent_uid: { type: DataTypes.STRING(128), allowNull: false },
                member_uid: { type: DataTypes.STRING(128), allowNull: false },
                name: { type: DataTypes.STRING(255), allowNull: true },
                iccid: { type: DataTypes.STRING(50), allowNull: true },
                relation: { type: DataTypes.STRING(100), allowNull: true },
                added_by: {
                    type: DataTypes.ENUM("crm", "parent"),
                    allowNull: false,
                    defaultValue: "crm",
                },
            },
            {
                sequelize,
                modelName: "FamilyMember",
                tableName: "family_members",
                underscored: true,
                timestamps: true,
            }
        );
    }
};
