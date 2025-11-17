const { Model, DataTypes } = require("sequelize");

class ContactTagComment extends Model {
    static init(sequelize) {
        return super.init(
            {
                contactTagId: {
                    type: DataTypes.BIGINT.UNSIGNED,
                    allowNull: false,
                    field: "contact_tag_id",
                },
                addedByUserId: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                    field: "added_by_user_id",
                },
                comment: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                },
                taggedUserId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: "tagged_user_id",
                },
            },
            {
                sequelize,
                modelName: "ContactTagComment",
                tableName: "contact_tag_comments",
                timestamps: true,
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

module.exports = ContactTagComment;
