const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { encryptAccessToken, decryptAccessToken, isTokenEncrypted } = require('../utils/tokenEncryption');

const CloudApiSetup = sequelize.define('CloudApiSetup', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  uid: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    defaultValue: () => uuidv4()
  },
  user_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false
  },
  admin_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true
  },
  webhook_verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  facebook_app_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  whatsapp_access_token: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const rawValue = this.getDataValue('whatsapp_access_token');
      if (!rawValue) return null;
      
      // If token is already encrypted, decrypt it
      if (isTokenEncrypted(rawValue)) {
        try {
          return decryptAccessToken(rawValue);
        } catch (error) {
          console.error('❌ Failed to decrypt whatsapp_access_token:', error.message);
          return null;
        }
      }
      
      // Return as-is if not encrypted (backward compatibility during migration)
      return rawValue;
    },
    set(value) {
      if (!value) {
        this.setDataValue('whatsapp_access_token', null);
        return;
      }
      
      // If already encrypted, store as-is
      if (isTokenEncrypted(value)) {
        this.setDataValue('whatsapp_access_token', value);
        return;
      }
      
      // Encrypt plaintext tokens before storing
      try {
        const encrypted = encryptAccessToken(value);
        this.setDataValue('whatsapp_access_token', encrypted);
      } catch (error) {
        console.error('❌ Failed to encrypt whatsapp_access_token:', error.message);
        throw error;
      }
    }
  },
  whatsapp_business_account_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  phone_number: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  phone_number_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  webhook_messages_field_verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  whatsapp_onboarding_raw_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  whatsapp_phone_numbers_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  embedded_setup_done_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  whatsapp_health_status_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  is_disabled_message_sound_notification: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  whatsapp_access_token_expired: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  whatsapp_phone_numbers: {
    type: DataTypes.JSON,
    allowNull: true
  },
  vendor_api_access_token: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  enable_vendor_webhook: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  vendor_webhook_endpoint: {
    type: DataTypes.STRING,
    allowNull: true
  },
  busy_notify_access: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  busy_notify_webhook_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  access_chats: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  // Coexistence-specific fields for WhatsApp Business app integration
  coexistence_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  smb_app_onboarded: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  chat_history_shared: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  contact_sync_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  // Two-step verification PIN (encrypted)
  two_step_verification_pin: {
    type: DataTypes.STRING,
    allowNull: true
  },
  two_step_verification_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  two_step_verification_set_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Display name approval tracking fields
  display_name_approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  display_name_approval_data: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  pin_timing_corrected: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  original_pin_set_incorrectly: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  pin_removal_failed: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  }
}, {
  tableName: 'cloud_api_setup',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['uid']
    },
    {
      fields: ['user_id']
    },
    {
      fields: ['admin_id']
    }
  ]
});

module.exports = CloudApiSetup; 