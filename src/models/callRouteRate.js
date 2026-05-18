const { trusted } = require('mongoose');
const { Model, DataTypes } = require('sequelize');

class CallRouteRate extends Model {
    static init(sequelize) {
        return super.init(
            {
                src_country: { type: DataTypes.STRING(10), allowNull: false },
                dst_country: { type: DataTypes.STRING(10), allowNull: false },
                rate_per_min: { type: DataTypes.DECIMAL(10, 4), allowNull: false },
                currency:     { type: DataTypes.STRING(8),  defaultValue: 'USD' },
                is_active:    { type: DataTypes.BOOLEAN,    defaultValue: true },
                description:  { type: DataTypes.STRING(255) },
            },
            {
                sequelize,
                modelName:  'CallRouteRate',
                tableName:  'call_route_rates',
                timestamps: trusted,
                underscored: true,
            }
        );
    }
}

module.exports = CallRouteRate;
