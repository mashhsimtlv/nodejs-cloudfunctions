const { Model, DataTypes } = require("sequelize");

class ContactTagStatus extends Model {
    static init(sequelize) {
        return super.init(
            {
                contactTagId: {
                    type: DataTypes.BIGINT.UNSIGNED,
                    allowNull: false,
                    field: "contact_tag_id",
                },
                userId: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                    field: "user_id",
                },
                status: {
                    type: DataTypes.STRING(50),
                    allowNull: false,
                },
                entertainedByUserId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: "entertained_by_user_id",
                },
            },
            {
                sequelize,
                modelName: "ContactTagStatus",
                tableName: "contact_tag_statuses",
                timestamps: true,
                indexes: [
                    {
                        unique: true,
                        fields: ["contact_tag_id", "user_id"],
                    },
                ],
            }
        );
    }

    static associate(models) {
        this.belongsTo(models.ContactTag, {
            as: "tag",
            foreignKey: "contact_tag_id",
        });
    }
}

module.exports = ContactTagStatus;
