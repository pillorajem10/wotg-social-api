// app/models/Playlist.js
const { Model, DataTypes } = require('sequelize');
const User= require('./User');
const sequelize = require('../../config/db');

class Playlist extends Model {}

Playlist.init({
    id: {
        type: DataTypes.INTEGER(11),
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    cover_image: {
        type: DataTypes.STRING(255), // File path or URL
        allowNull: true,
    },
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },      
    visibility: {
        type: DataTypes.ENUM('public', 'private'),
        allowNull: false,
        defaultValue: 'public',
    },
}, {
    sequelize,
    modelName: 'Playlist',
    tableName: 'playlists',
    timestamps: true,
    underscored: true,
});

Playlist.belongsTo(User, { foreignKey: 'created_by' });

module.exports = Playlist;
