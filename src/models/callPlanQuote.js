const { Model, DataTypes } = require("sequelize");

class CallPlanQuote extends Model {
    static init(sequelize) {
        return super.init(
            {
                user_id: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                },
                start_time: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                end_time: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                country: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                },
                plan_type: {
                    type: DataTypes.ENUM("incoming", "incoming_outgoing"),
                    allowNull: false,
                    defaultValue: "incoming_outgoing",
                },
                minutes_option: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                },
                days: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                },
                base_price: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: false,
                },
                extra_price: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: false,
                    defaultValue: 0,
                },
                minutes_upgrade_price: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: false,
                    defaultValue: 0,
                },
                total_price: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: false,
                },
                per_minute_rate: {
                    type: DataTypes.DECIMAL(10, 4),
                    allowNull: false,
                },
                credit_value: {
                    type: DataTypes.DECIMAL(10, 2),
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: "CallPlanQuote",
                tableName: "call_plan_quotes",
                timestamps: true,
            }
        );
    }
}

module.exports = CallPlanQuote;
