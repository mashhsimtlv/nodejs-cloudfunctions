const { Model, DataTypes } = require("sequelize");

class CallNumber extends Model {
    static init(sequelize) {
        return super.init(
            {
                number: {
                    type: DataTypes.STRING(50),
                    allowNull: false,
                    unique: true,
                },
                country: {
                    type: DataTypes.STRING(100),
                    allowNull: false,
                },
                password: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
                },
                is_occupied: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
            },
            {
                sequelize,
                modelName: "CallNumber",
                tableName: "calling_numbers",
                timestamps: true,
            }
        );
    }

    static associate(models) {
        this.hasMany(models.UserCallerNumber, {
            foreignKey: "calling_number_id",
            as: "userLinks",
        });
    }
}

module.exports = CallNumber;
