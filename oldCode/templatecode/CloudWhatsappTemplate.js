const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const cloudWhatsappTemplate = sequelize.define('cloudWhatsappTemplate', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  uid: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  user_id: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  admin_id: {
    type: DataTypes.BIGINT,
    allowNull: false
  }, 
  template_name: {
    type: DataTypes.STRING(512),
    allowNull: true
  },
  // Note: Versioning fields have been removed
  template_id: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  category: {
    type: DataTypes.STRING(45),
    allowNull: false
  },
  language: {
    type: DataTypes.STRING(45),
    allowNull: false
  },
  parameter_format: {
    type: DataTypes.ENUM('POSITIONAL', 'NAMED'),
    allowNull: false,
    defaultValue: 'POSITIONAL',
    comment: 'Variable parameter format for Meta API (POSITIONAL or NAMED)'
  },
  temp_data: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const rawValue = this.getDataValue('temp_data');
      if (!rawValue) return null;
      try {
        return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      } catch (error) {
        console.error('Error parsing temp_data:', error);
        return rawValue;
      }
    },
    set(value) {
      if (typeof value === 'object' && value !== null) {
        this.setDataValue('temp_data', JSON.stringify(value));
      } else {
        this.setDataValue('temp_data', value);
      }
    }
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'DRAFT', 'PAUSED', 'DISABLED'),
    allowNull: false,
    defaultValue: 'DRAFT'
  },
  // Meta API specific fields
  meta_template_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Template ID from Meta API after submission'
  },
  waba_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'WhatsApp Business Account ID'
  },
  quality_rating: {
    type: DataTypes.ENUM('GREEN', 'YELLOW', 'RED', 'UNKNOWN'),
    allowNull: true,
    defaultValue: 'UNKNOWN'
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Reason for rejection from Meta'
  },
  meta_raw_data: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    comment: 'Raw response data from Meta API',
    get() {
      const rawValue = this.getDataValue('meta_raw_data');
      if (!rawValue) return null;
      try {
        return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      } catch (error) {
        console.error('Error parsing meta_raw_data:', error);
        return rawValue;
      }
    },
    set(value) {
      if (typeof value === 'object' && value !== null) {
        this.setDataValue('meta_raw_data', JSON.stringify(value));
      } else {
        this.setDataValue('meta_raw_data', value);
      }
    }
  },
  template_media_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Stored media URL from template header (extracted from header_handle). Used for reusing media without re-upload.'
  },
  template_media_type: {
    type: DataTypes.ENUM('IMAGE', 'VIDEO', 'DOCUMENT', 'NONE'),
    allowNull: true,
    defaultValue: 'NONE',
    comment: 'Type of media in template header'
  },
  submitted_to_meta_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When template was submitted to Meta for review'
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When template was approved by Meta'
  },
  last_synced_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time template data was synced from Meta API'
  }
}, {
  tableName: 'cloud_whatsapp_templates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['admin_id'] },
    { fields: ['meta_template_id'] },
    { fields: ['waba_id'] },
    { fields: ['status'] },
    { fields: ['template_name'] },
    { fields: ['submitted_to_meta_at'] },
    { unique: true, fields: ['user_id', 'template_name'], name: 'unique_user_template_name' }
  ]
});

module.exports = cloudWhatsappTemplate; 