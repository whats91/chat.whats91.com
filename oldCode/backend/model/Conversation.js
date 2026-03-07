const { DataTypes } = require('sequelize');
const { conversationsSequelize } = require('../config/conversationsDatabase');

const Conversation = conversationsSequelize.define('Conversation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  contact_phone: {
    type: DataTypes.STRING(25),
    allowNull: false
  },
  contact_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'contacts',
      key: 'id'
    }
  },
  contact_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  whatsapp_phone_number_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  last_message_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  last_message_content: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  last_message_type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  last_message_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_message_direction: {
    type: DataTypes.ENUM('inbound', 'outbound'),
    allowNull: true
  },
  unread_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total_messages: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  is_archived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_pinned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_muted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  status: {
    type: DataTypes.ENUM('active', 'closed', 'blocked'),
    defaultValue: 'active'
  },
  meta_data: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'conversations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['user_id', 'contact_phone']
    },
    {
      fields: ['user_id', 'last_message_at']
    },
    {
      fields: ['whatsapp_phone_number_id']
    },
    {
      fields: ['contact_id']
    }
  ]
});

module.exports = Conversation;
