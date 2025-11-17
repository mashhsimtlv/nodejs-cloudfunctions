const { Model, DataTypes } = require("sequelize");

class ContactTag extends Model {
    static init(sequelize) {
        return super.init(
            {
                eventType: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                    field: "event_type",
                },
                eventId: {
                    type: DataTypes.STRING(191),
                    allowNull: true,
                    field: "event_id",
                },
                contactId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: "contact_id",
                },
                contactFirstName: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                    field: "contact_first_name",
                },
                contactLastName: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                    field: "contact_last_name",
                },
                contactEmail: {
                    type: DataTypes.STRING(191),
                    allowNull: true,
                    field: "contact_email",
                },
                contactPhone: {
                    type: DataTypes.STRING(50),
                    allowNull: true,
                    field: "contact_phone",
                },
                contactCountryCode: {
                    type: DataTypes.STRING(10),
                    allowNull: true,
                    field: "contact_country_code",
                },
                contactStatus: {
                    type: DataTypes.STRING(50),
                    allowNull: true,
                    field: "contact_status",
                },
                assigneeId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: "assignee_id",
                },
                assigneeEmail: {
                    type: DataTypes.STRING(191),
                    allowNull: true,
                    field: "assignee_email",
                },
                assigneeFirstName: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                    field: "assignee_first_name",
                },
                assigneeLastName: {
                    type: DataTypes.STRING(100),
                    allowNull: true,
                    field: "assignee_last_name",
                },
                commentText: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                    field: "comment_text",
                },
                tags: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                    field: "tags",
                },
                mentionedUserIds: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                    field: "mentioned_user_ids",
                },
                mentionedUserEmails: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                    field: "mentioned_user_emails",
                },
                rawPayload: {
                    type: DataTypes.TEXT('long'),
                    allowNull: true,
                    field: "raw_payload",
                },
            },
            {
                sequelize,
                modelName: "ContactTag",
                tableName: "contact_tags",
                timestamps: true,
            }
        );
    }

    static associate(models) {
        this.hasMany(models.ContactTagStatus, {
            as: "statuses",
            foreignKey: "contact_tag_id",
        });
        this.hasMany(models.ContactTagComment, {
            as: "comments",
            foreignKey: "contact_tag_id",
        });
    }
}

module.exports = ContactTag;
