const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/db');
const User = require('./User'); // Import User model

class Subscription extends Model {}

Subscription.init({
    id: {
        type: DataTypes.INTEGER(11),
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
    },
    userId: {
        type: DataTypes.INTEGER(11),
        allowNull: false, // Foreign key for User model
    },
    deviceId: {
        type: DataTypes.STRING, // Store unique device identifier
        allowNull: false,
    },
    subscription: {
        type: DataTypes.JSON, // Use JSON for push subscription details
        allowNull: false,
    },
}, {
    sequelize,
    modelName: 'Subscription',
    tableName: 'subscriptions',
    timestamps: true,
    underscored: true,
});

// Define relationships programmatically (no database constraints)
Subscription.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = Subscription;
