const { DataTypes } = require('sequelize');
const { conversationsSequelize } = require('../config/conversationsDatabase');

const MediaStorage = conversationsSequelize.define('MediaStorage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'User who owns this media'
  },
  message_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    comment: 'WhatsApp message ID or database message ID'
  },
  wasabi_path: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Path to media file in Wasabi storage'
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'MIME type of the media file'
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'File size in bytes'
  },
  original_filename: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Original filename from WhatsApp'
  }
}, {
  tableName: 'media_storage',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['message_id'],
      unique: true
    }
  ]
});

module.exports = MediaStorage;
