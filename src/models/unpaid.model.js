const { Model, DataTypes } = require("sequelize");

class UnpaidUser extends Model {
    static init(sequelize) {
        return super.init(
            {
                name: {
                    type: DataTypes.STRING(150),
                    allowNull: false,
                },
                email: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
                },
                user_id: {
                    type: DataTypes.STRING(100), allowNull: false
                },
                transaction_id: {
                    type: DataTypes.STRING(150),
                    allowNull: true, // can be null if user never attempted payment
                },
                status: {
                    type: DataTypes.ENUM("paid", "unpaid"),
                    allowNull: false,
                    defaultValue: "unpaid",
                },
            },
            {
                sequelize,
                modelName: "UnpaidUser",
                tableName: "unpaid_users",
                timestamps: true,
            }
        );
    }

    static associate(models) {
        // optional: link to your User model if you have one
        // this.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
}

module.exports = UnpaidUser;
