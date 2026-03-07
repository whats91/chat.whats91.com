const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  uid: {
    type: DataTypes.STRING(252),
    allowNull: true
  },
  admin_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  name: {
    type: DataTypes.STRING(191),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(191),
    allowNull: true,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING(191),
    allowNull: true
  },
  mobile_number_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp when phone number was verified via OTP'
  },
  username: {
    type: DataTypes.STRING(191),
    allowNull: false,
    unique: true
  },
  sms_count: {
    type: DataTypes.BIGINT,
    allowNull: true,
    defaultValue: 0
  },
  password: {
    type: DataTypes.STRING(191),
    allowNull: false
  },
  status: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: true,
    defaultValue: 1
  },
  type: {
    type: DataTypes.ENUM('admin', 'employee', 'customer', 'administrator'),
    allowNull: false
  },
  email_verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  device_token: {
    type: DataTypes.STRING(191),
    allowNull: true
  },
  country: {
    type: DataTypes.STRING(191),
    allowNull: true
  },
  is_guest: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: true,
    defaultValue: 10
  },
  permissions: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  session_count: {
    type: DataTypes.BIGINT,
    allowNull: true,
    defaultValue: 1
  },
  sms_min_count: {
    type: DataTypes.BIGINT,
    allowNull: true,
    defaultValue: 1
  },
  auth_token: {
    type: DataTypes.STRING(252),
    allowNull: true
  },
  billing_type: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'points'
  },
  whatsapp_type: {
    type: DataTypes.ENUM('cloud', 'standard', 'both'),
    allowNull: false,
    defaultValue: 'standard'
  },
  demo_period: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 2,
    comment: 'Demo period in days for customers under this admin/partner'
  },
  meta_billing_managed_by: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'false = customer manages billing, true = we manage billing'
  }
}, {
  tableName: 'users',
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  hooks: {
    beforeSave: async (user) => {
      if (user.changed('password')) {
        user.password = await User.hashPassword(user.password);
      }
    },
    beforeCreate: (user) => {
      // If verified_at isn't explicitly set and this is a new record,
      // set it to match created_at (which will be set by Sequelize)
      if (!user.verified_at) {
        user.verified_at = new Date();
      }
    }
  }
});

// Class method to hash password
User.hashPassword = async (password) => {
  // Ensure password is a string to prevent bcrypt errors
  const passwordString = String(password);
  return await bcrypt.hash(passwordString, 10);
};

// Instance method to validate password
User.prototype.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Instance method to check if user is verified
User.prototype.isVerified = function() {
  return this.verified_at !== null;
};

module.exports = User; 