const { DataTypes } = require('sequelize');
const { conversationsSequelize } = require('../config/conversationsDatabase');

const ConversationMessage = conversationsSequelize.define('ConversationMessage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'conversations',
      key: 'id'
    }
  },
  whatsapp_message_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  from_phone: {
    type: DataTypes.STRING(25),
    allowNull: false
  },
  to_phone: {
    type: DataTypes.STRING(25),
    allowNull: false
  },
  direction: {
    type: DataTypes.ENUM('inbound', 'outbound'),
    allowNull: false
  },
  message_type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message_content: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  media_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  media_mime_type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  media_filename: {
    type: DataTypes.STRING,
    allowNull: true
  },
  media_caption: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'delivered', 'read', 'failed'),
    defaultValue: 'pending'
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  replied_to_message_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  forwarded_from: {
    type: DataTypes.STRING,
    allowNull: true
  },
  interactive_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  location_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  contact_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  webhook_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  outgoing_payload: {
    type: DataTypes.JSON,
    allowNull: true
  },
  incoming_payload: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'conversation_messages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['conversation_id', 'timestamp']
    },
    {
      fields: ['whatsapp_message_id']
    },
    {
      fields: ['from_phone']
    },
    {
      fields: ['to_phone']
    },
    {
      fields: ['direction', 'status']
    }
  ]
});

module.exports = ConversationMessage;
