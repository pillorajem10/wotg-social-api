// app/models/Chatroom.js
const { Model, DataTypes } = require('sequelize');
const sequelize = require('../../config/db');

class Chatroom extends Model {}

Chatroom.init({
    id: {
        type: DataTypes.INTEGER(11),
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: true, // Optional for private chats
    },
    type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'group', // Default to group chats, can be 'private'
    },
    chatroom_photo: {
        type: DataTypes.STRING(255), // Stores file name or full URL
        allowNull: true, // Optional field
    }
}, {
    sequelize,
    modelName: 'Chatroom',
    tableName: 'chatrooms',
    timestamps: true,
    underscored: true,
});

module.exports = Chatroom;
