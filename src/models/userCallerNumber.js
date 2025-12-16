const { Model, DataTypes } = require("sequelize");

class UserCallerNumber extends Model {
    static init(sequelize) {
        return super.init(
            {
                id: {
                    type: DataTypes.BIGINT,
                    autoIncrement: true,
                    primaryKey: true,
                },
                user_id: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                },
                calling_number_id: {
                    type: DataTypes.BIGINT,
                    allowNull: false,
                },
                start_time: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                end_time: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                current_balance: {
                    type: DataTypes.DECIMAL(12, 2),
                    allowNull: false,
                    defaultValue: 0,
                },
            },
            {
                sequelize,
                modelName: "UserCallerNumber",
                tableName: "user_caller_numbers",
                timestamps: true,
            }
        );
    }

    static associate(models) {
        this.belongsTo(models.CallNumber, {
            foreignKey: "calling_number_id",
            as: "callingNumber",
        });
    }
}

module.exports = UserCallerNumber;
