const User = require('../models/User');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: './.env' });
const { Setting, UserPermissions, AdminOTP, AdminLoginLog, CustomerLoginLog } = require('../models');
const shortUUID = require('short-uuid');
const uidGenerator = shortUUID();
const { v4: uuidv4 } = require('uuid');
const { sendMessageDirect } = require('./baileysController');
const activeUserSessions = require('../utils/activeUserSessions');

// Function to get appropriate domain for cookies based on request origin
const getCookieDomain = async (req) => {
  if (process.env.NODE_ENV !== 'production') {
    // In development, don't set domain to allow localhost
    return undefined;
  }
  
  const origin = req.get('Origin') || req.get('Referer');
  const mainDomain = process.env.MAIN_DOMAIN || 'botmastersender.com';
  
  if (!origin) {
    // No origin means same-origin request, use main domain
    return mainDomain;
  }
  
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // If request comes from main domain or its subdomains, use main domain
    if (hostname === mainDomain || hostname.endsWith('.' + mainDomain)) {
      return mainDomain;
    }
    
    // For cross-origin requests (white-label domains), validate the domain
    const WhiteLabelConfig = require('../models/WhiteLabelConfig');
    const configs = await WhiteLabelConfig.findAll({
      attributes: ['domain_name']
    });
    
    const allowedDomains = configs.map(config => config.domain_name);
    
    // Check if the origin is an allowed white-label domain
    const isAllowedDomain = allowedDomains.some(allowedDomain => 
      hostname === allowedDomain || hostname.endsWith('.' + allowedDomain)
    );
    
    if (isAllowedDomain) {
      // For white-label domains, don't set domain attribute
      // This allows the cookie to be set for the backend domain
      return undefined;
    }
    
    // Unknown domain, fallback to main domain
    return mainDomain;
  } catch (error) {
    console.error('Error parsing origin for cookie domain:', error);
    return mainDomain;
  }
};

// Helper to get client IP in a proxy-friendly way
const getClientIp = (req) => {
  try {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor && typeof xForwardedFor === 'string') {
      const parts = xForwardedFor.split(',');
      if (parts.length > 0) {
        return parts[0].trim();
      }
    }
    return (
      req.ip ||
      (req.connection && req.connection.remoteAddress) ||
      (req.socket && req.socket.remoteAddress) ||
      null
    );
  } catch (error) {
    console.error('Error determining client IP:', error);
    return null;
  }
};

// Helper to determine JWT and cookie lifetime based on user type
const getSessionLifetimes = (userType) => {
  // Administrators: 48 hours
  // Admins and Customers: 90 days
  if (userType === 'administrator') {
    return {
      jwtExpiry: '48h',
      cookieMaxAgeMs: 48 * 60 * 60 * 1000
    };
  }

  // Admin and Customer: 90 days
  return {
    jwtExpiry: '90d',
    cookieMaxAgeMs: 90 * 24 * 60 * 60 * 1000
  };
};

// Helper to log administrator logins
const logAdminLogin = async (user, req) => {
  try {
    if (!user || user.type !== 'administrator') {
      return;
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    await AdminLoginLog.create({
      admin_id: user.id,
      admin_name: user.name,
      ip_address: ipAddress,
      user_agent: userAgent,
      login_time: new Date()
    });
  } catch (error) {
    // Never block login flow due to logging issues
    console.error('Error logging administrator login:', error);
  }
};

// Helper to log customer logins
const logCustomerLogin = async (user, req) => {
  try {
    if (!user || user.type !== 'customer') {
      return;
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    await CustomerLoginLog.create({
      user_id: user.id,
      ip_address: ipAddress,
      user_agent: userAgent,
      login_time: new Date()
    });
  } catch (error) {
    // Never block login flow due to logging issues
    console.error('Error logging customer login:', error);
  }
};

// Add OTP storage (in-memory for simplicity, consider using Redis in production)
const otpStore = new Map();
const verificationOtpStore = new Map(); // Separate store for verification OTPs
const passwordResetOtpStore = new Map(); // Separate store for password reset OTPs

// Generate a random 6-digit OTP - moved outside the controller object
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper to send OTP with admin-specific credentials and automatic .env fallback
const sendOtpMessageWithFallback = async ({ user, phone, messageText }) => {
  let adminSenderId = null;
  let adminAuthToken = null;

  // Try to load admin-specific OTP credentials if admin_id is present
  if (user && user.admin_id) {
    try {
      console.log(`Looking for admin OTP credentials for user ${user.id} with admin_id: ${user.admin_id}`);
      const adminOtp = await AdminOTP.findOne({
        where: { admin_id: user.admin_id },
        order: [['created_at', 'DESC']]
      });

      if (adminOtp && adminOtp.session_id && adminOtp.auth_token) {
        adminSenderId = adminOtp.session_id;
        adminAuthToken = adminOtp.auth_token;
        console.log(
          `Found admin OTP credentials: senderId=${adminSenderId}, authToken=${adminAuthToken ? 'exists' : 'missing'}`
        );
      } else {
        console.log(`No valid AdminOTP record found for admin_id: ${user.admin_id}`);
      }
    } catch (error) {
      console.error('Error loading admin OTP credentials:', error);
    }
  } else if (user) {
    console.log(`User ${user.id} has no admin_id, will use default credentials for OTP`);
  }

  const envSenderId = process.env.WHATSAPP_SENDER_ID;
  const envAuthToken = process.env.WHATSAPP_AUTH_TOKEN;

  // Small helper to actually send the message with given credentials
  const attemptSend = async (senderId, authToken, label) => {
    if (!senderId || !authToken) {
      console.error(`Missing credentials for ${label} OTP send`);
      return { success: false, error: `Missing credentials for ${label}` };
    }

    try {
      console.log(
        `📩 Sending OTP to ${phone} using ${label} credentials (senderId=${senderId})`
      );
      const response = await sendMessageDirect({
        authToken,
        senderId,
        receiverId: phone,
        messageText
      });

      if (!response || !response.success) {
        console.error(
          `Failed to send OTP with ${label} credentials:`,
          response?.message || 'Unknown error'
        );
        return {
          success: false,
          error: response?.message || `Failed to send OTP with ${label} credentials`
        };
      }

      return { success: true };
    } catch (error) {
      console.error(`Error sending OTP with ${label} credentials:`, error);
      return {
        success: false,
        error: error.message || `Error sending OTP with ${label} credentials`
      };
    }
  };

  // 1) Try admin-specific credentials first if available
  if (adminSenderId && adminAuthToken) {
    const adminResult = await attemptSend(adminSenderId, adminAuthToken, 'admin');
    if (adminResult.success) {
      return { success: true };
    }

    // 2) If admin credentials failed, immediately fall back to .env credentials
    if (envSenderId && envAuthToken) {
      console.log('Retrying OTP send with fallback .env credentials after admin config failure');
      const envResult = await attemptSend(envSenderId, envAuthToken, '.env');
      if (envResult.success) {
        return { success: true };
      }
      return envResult;
    }

    // No env credentials available
    return adminResult;
  }

  // 3) If no admin-specific credentials, use .env as primary
  if (envSenderId && envAuthToken) {
    console.log('Using default environment credentials for OTP');
    const envResult = await attemptSend(envSenderId, envAuthToken, '.env');
    return envResult;
  }

  console.error('No OTP credentials configured (neither admin-specific nor .env)');
  return {
    success: false,
    error: 'No OTP sending credentials configured'
  };
};

const authController = {
  // Get countries list
  async getCountries(req, res) {
    try {
      const { search } = req.query;
      const countriesList = require('../utils/countriesList');
      
      let countries;
      if (search) {
        countries = countriesList.searchCountries(search);
      } else {
        countries = countriesList.getAllCountries();
      }
      
      return res.json({
        success: true,
        data: countries
      });
    } catch (error) {
      console.error('Error getting countries:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching countries',
        error: error.message
      });
    }
  },

  // Request OTP for login
  async requestLoginOTP(req, res) {
    try {
      const { phone } = req.body;
      
      if (!phone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is required'
        });
      }

      // Find user by phone number (only active users)
      const user = await User.findOne({ where: { phone, status: 1 } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account found with this phone number or account is inactive'
        });
      }

            // get user partner information we call partner as admin
            const partner = await User.findOne({ where: { id: user.admin_id , status: 1 } });
            if (!partner) {
              return res.status(404).json({
                success: false,
                message: 'No partner found for this user or account is inactive'
              });
            }

      // Generate OTP using the function defined outside the controller
      const otp = generateOTP();
      
      // Store OTP with expiration (10 minutes)
      const expiryTime = new Date();
      expiryTime.setMinutes(expiryTime.getMinutes() + 10);
      
      otpStore.set(phone, {
        otp,
        expiry: expiryTime,
        attempts: 0
      });

      // Send OTP via WhatsApp
      const messageText = `Your BotMasterSender login OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`;
      
      try {
        // Send OTP with admin-specific credentials and automatic .env fallback
        const sendResult = await sendOtpMessageWithFallback({ user, phone, messageText });

        if (!sendResult.success) {
          throw new Error(sendResult.error || 'Failed to send OTP');
        }
        
        return res.json({
          success: true,
          message: 'OTP sent successfully',
          phone: phone // Return masked phone for verification
        });
      } catch (error) {
        console.error('Error sending OTP:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to send OTP. Please try again.'
        });
      }
    } catch (error) {
      console.error('OTP request error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error processing OTP request',
        error: error.message
      });
    }
  },

  // Request OTP for user verification
  async requestVerificationOTP(req, res) {
    try {
      // This endpoint requires authentication
      const userId = req.user.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Find user
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is already verified
      if (user.verified_at) {
        return res.status(400).json({
          success: false,
          message: 'User is already verified'
        });
      }

      // Check if user has a phone number
      if (!user.phone) {
        return res.status(400).json({
          success: false,
          message: 'User does not have a phone number'
        });
      }

      // Generate OTP
      const otp = generateOTP();
      
      // Store OTP with expiration (10 minutes)
      const expiryTime = new Date();
      expiryTime.setMinutes(expiryTime.getMinutes() + 10);
      
      verificationOtpStore.set(user.phone, {
        otp,
        expiry: expiryTime,
        attempts: 0,
        userId: user.id
      });

      // Send OTP via WhatsApp (reusing admin + .env fallback)
      const messageText = `Your BotMasterSender verification OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`;
      
      try {
        const sendResult = await sendOtpMessageWithFallback({
          user,
          phone: user.phone,
          messageText
          });
          
        if (!sendResult.success) {
          throw new Error(sendResult.error || 'Failed to send verification OTP');
        }
        
        return res.json({
          success: true,
          message: 'Verification OTP sent successfully',
          phone: user.phone
        });
      } catch (error) {
        console.error('Error sending verification OTP:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to send verification OTP. Please try again.'
        });
      }
    } catch (error) {
      console.error('Verification OTP request error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error processing verification OTP request',
        error: error.message
      });
    }
  },

  // Verify OTP for user verification
  async verifyUserOTP(req, res) {
    try {
      const { otp } = req.body;
      const userId = req.user.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (!otp) {
        return res.status(400).json({
          success: false,
          message: 'OTP is required'
        });
      }

      // Find user
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is already verified
      if (user.verified_at) {
        return res.status(400).json({
          success: false,
          message: 'User is already verified'
        });
      }

      // Check if user has a phone number
      if (!user.phone) {
        return res.status(400).json({
          success: false,
          message: 'User does not have a phone number'
        });
      }

      // Check if OTP exists and is valid
      const otpData = verificationOtpStore.get(user.phone);
      
      if (!otpData) {
        return res.status(400).json({
          success: false,
          message: 'No verification OTP requested for this user'
        });
      }

      // Check if OTP is for the correct user
      if (otpData.userId !== user.id) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP for this user'
        });
      }

      // Check if OTP is expired
      if (new Date() > otpData.expiry) {
        verificationOtpStore.delete(user.phone);
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one.'
        });
      }

      // Increment attempt counter
      otpData.attempts += 1;
      
      // Check max attempts (3)
      if (otpData.attempts > 3) {
        verificationOtpStore.delete(user.phone);
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }

      // Verify OTP
      if (otpData.otp !== otp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP',
          attemptsLeft: 3 - otpData.attempts
        });
      }

      // OTP is valid, update user verification status
      user.verified_at = new Date();
      await user.save();

      // Clear OTP after successful verification
      verificationOtpStore.delete(user.phone);

      return res.json({
        success: true,
        message: 'User verified successfully',
        verified_at: user.verified_at
      });
    } catch (error) {
      console.error('User verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying user',
        error: error.message
      });
    }
  },

  // Check user verification status
  async checkVerificationStatus(req, res) {
    try {
      const userId = req.user.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Find user
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      return res.json({
        success: true,
        isVerified: user.isVerified(),
        verified_at: user.verified_at
      });
    } catch (error) {
      console.error('Check verification status error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking verification status',
        error: error.message
      });
    }
  },

  // Request OTP for password reset (by phone or email)
  async requestPasswordResetOTP(req, res) {
    try {
      const { phone, email } = req.body;

      if (!phone && !email) {
        return res.status(400).json({
          success: false,
          message: 'Phone number or email is required'
        });
      }

      // Find user by phone or email (only active users)
      let user;
      let identifier; // Store the identifier used for OTP storage
      
      if (phone) {
        user = await User.findOne({ where: { phone, status: 1 } });
        identifier = phone;
      } else if (email) {
        user = await User.findOne({ where: { email, status: 1 } });
        identifier = email;
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account found with this phone/email or account is inactive'
        });
      }

      // Ensure user has a partner/admin as per business rules (for customers)
      if (user.type === 'customer') {
        const partner = await User.findOne({ where: { id: user.admin_id, status: 1 } });
        if (!partner) {
          return res.status(404).json({
            success: false,
            message: 'No partner found for this user or account is inactive'
          });
        }
      }

      const otp = generateOTP();

      const expiryTime = new Date();
      expiryTime.setMinutes(expiryTime.getMinutes() + 10);

      // Store OTP with expiration and user reference
      passwordResetOtpStore.set(identifier, {
        otp,
        expiry: expiryTime,
        attempts: 0,
        userId: user.id,
        method: phone ? 'phone' : 'email'
      });

      // Send OTP via phone or email
      try {
        let sendResult;
        
        if (phone) {
          // Send via WhatsApp
          const messageText = `Your BotMasterSender password reset OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`;
          sendResult = await sendOtpMessageWithFallback({ user, phone, messageText });
        } else if (email) {
          // Send via Email
          const emailController = require('./emailController');
          sendResult = await emailController.sendPasswordResetOTP(email, user.name, otp);
        }

        if (!sendResult.success) {
          throw new Error(sendResult.error || 'Failed to send password reset OTP');
        }

        return res.json({
          success: true,
          message: sendResult.message || 'Password reset OTP sent successfully',
          method: phone ? 'phone' : 'email',
          identifier: phone || email
        });
      } catch (error) {
        console.error('Error sending password reset OTP:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to send password reset OTP. Please try again.'
        });
      }
    } catch (error) {
      console.error('Password reset OTP request error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error processing password reset OTP request',
        error: error.message
      });
    }
  },

  // Verify password reset OTP and return a short-lived reset token
  async verifyPasswordResetOTP(req, res) {
    try {
      const { phone, email, otp } = req.body;

      if ((!phone && !email) || !otp) {
        return res.status(400).json({
          success: false,
          message: 'Phone/email and OTP are required'
        });
      }

      const identifier = phone || email;
      const otpData = passwordResetOtpStore.get(identifier);

      if (!otpData) {
        return res.status(400).json({
          success: false,
          message: 'No password reset OTP requested for this phone/email'
        });
      }

      // Check if OTP is expired
      if (new Date() > otpData.expiry) {
        passwordResetOtpStore.delete(identifier);
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one.'
        });
      }

      // Increment attempt counter
      otpData.attempts += 1;

      if (otpData.attempts > 3) {
        passwordResetOtpStore.delete(identifier);
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }

      if (otpData.otp !== otp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP',
          attemptsLeft: 3 - otpData.attempts
        });
      }

      // OTP is valid, clear store entry and issue short-lived reset token
      passwordResetOtpStore.delete(identifier);

      const user = await User.findByPk(otpData.userId);
      if (!user || user.status !== 1) {
        return res.status(404).json({
          success: false,
          message: 'User not found or account is inactive'
        });
      }

      const resetToken = jwt.sign(
        {
          id: user.id,
          type: user.type,
          purpose: 'password_reset'
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      return res.json({
        success: true,
        message: 'OTP verified successfully',
        resetToken
      });
    } catch (error) {
      console.error('Password reset OTP verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying password reset OTP',
        error: error.message
      });
    }
  },

  // Reset password using a valid password reset token
  async resetPasswordWithToken(req, res) {
    try {
      const { resetToken, newPassword } = req.body;

      if (!resetToken || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Reset token and new password are required'
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }

      if (!decoded || decoded.purpose !== 'password_reset' || !decoded.id) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset token payload'
        });
      }

      const user = await User.findByPk(decoded.id);
      if (!user || user.status !== 1) {
        return res.status(404).json({
          success: false,
          message: 'User not found or account is inactive'
        });
      }

      // Basic password validation (can be extended as needed)
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long'
        });
      }

      // Set new password; model hooks should handle hashing
      user.password = String(newPassword);
      await user.save();

      return res.json({
        success: true,
        message: 'Password has been reset successfully'
      });
    } catch (error) {
      console.error('Password reset error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error resetting password',
        error: error.message
      });
    }
  },

  // Verify OTP and login
  async verifyLoginOTP(req, res) {
    try {
      const { phone, otp } = req.body;
      
      if (!phone || !otp) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and OTP are required'
        });
      }

      // Check if OTP exists and is valid
      const otpData = otpStore.get(phone);
      
      if (!otpData) {
        return res.status(400).json({
          success: false,
          message: 'No OTP requested for this phone number'
        });
      }

      // Check if OTP is expired
      if (new Date() > otpData.expiry) {
        otpStore.delete(phone);
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one.'
        });
      }

      // Increment attempt counter
      otpData.attempts += 1;
      
      // Check max attempts (3)
      if (otpData.attempts > 3) {
        otpStore.delete(phone);
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }

      // Verify OTP
      if (otpData.otp !== otp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP',
          attemptsLeft: 3 - otpData.attempts
        });
      }

      // OTP is valid, find user and login (only active users)
      const user = await User.findOne({ where: { phone, status: 1 } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found or account is inactive'
        });
      }

                  // get user partner information we call partner as admin
                  const partner = await User.findOne({ where: { id: user.admin_id , status: 1 } });
                  if (!partner) {
                    return res.status(404).json({
                      success: false,
                      message: 'No partner found for this user or account is inactive'
                    });
                  }

      // Clear OTP after successful verification
      otpStore.delete(phone);

      // Determine session lifetimes based on user type
      const { jwtExpiry, cookieMaxAgeMs } = getSessionLifetimes(user.type);

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, type: user.type },
        process.env.JWT_SECRET,
        { expiresIn: jwtExpiry }
      );

      // Mark user as actively logged in
      activeUserSessions.setUserActive(user.id, user.type);

      // Mark user as actively logged in
      activeUserSessions.setUserActive(user.id, user.type);

      // Fetch settings
      const settings = await Setting.findAll();
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});

      // Determine if this is a cross-origin request from an allowed white-label domain
      const origin = req.get('Origin') || req.get('Referer');
      const mainDomain = process.env.MAIN_DOMAIN || 'botmastersender.com';
      let isCrossOrigin = false;
      
      if (origin && !origin.includes(mainDomain)) {
        // Check if this origin is in our allowed white-label domains
        try {
          const url = new URL(origin);
          const hostname = url.hostname;
          
          const WhiteLabelConfig = require('../models/WhiteLabelConfig');
          const configs = await WhiteLabelConfig.findAll({
            attributes: ['domain_name']
          });
          
          const allowedDomains = configs.map(config => config.domain_name);
          const isAllowedDomain = allowedDomains.some(allowedDomain => 
            hostname === allowedDomain || hostname.endsWith('.' + allowedDomain)
          );
          
          isCrossOrigin = isAllowedDomain;
        } catch (error) {
          console.error('Error validating white-label domain:', error);
          isCrossOrigin = false; // Reject if we can't validate
        }
      }
      
      // Set cookie options
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: isCrossOrigin ? 'none' : 'lax',
        maxAge: cookieMaxAgeMs,
        path: '/',
      };

      // Set domain dynamically based on request origin
      const cookieDomain = await getCookieDomain(req);
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }

      res.cookie('token', token, cookieOptions);

      // Log administrator login (if applicable)
      await logAdminLogin(user, req);
      // Log customer login (if applicable)
      await logCustomerLogin(user, req);

      // Add Partitioned attribute for cross-origin requests to prevent browser warnings
      if (isCrossOrigin && process.env.NODE_ENV === 'production') {
        const existingSetCookie = res.getHeader('Set-Cookie') || [];
        const cookies = Array.isArray(existingSetCookie) ? existingSetCookie : [existingSetCookie];
        const modifiedCookies = cookies.map(cookie => {
          if (typeof cookie === 'string' && cookie.startsWith('token=') && !cookie.includes('Partitioned')) {
            return cookie + '; Partitioned';
          }
          return cookie;
        });
        res.setHeader('Set-Cookie', modifiedCookies);
      }

      const userData = {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        isVerified: user.isVerified()
      };

      return res.json({
        success: true,
        user: userData,
        settings: settingsMap,
        token
      });
    } catch (error) {
      console.error('OTP verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying OTP',
        error: error.message
      });
    }
  },

  async register(req, res) {
    try {
      const { association_no, name, email, phone, username, password, type, senderId, uid = uidGenerator.generate(), auth_token = null, partner_uid = null, country } = req.body;
      
      // Debug logging to identify the issue
      console.log('Registration request body:', {
        association_no: typeof association_no,
        name: typeof name,
        email: typeof email,
        phone: typeof phone,
        username: typeof username,
        password: typeof password,
        type: typeof type,
        senderId: typeof senderId,
        uid: typeof uid,
        auth_token: typeof auth_token,
        partner_uid: typeof partner_uid
      });
      
      // Validate required fields
      const requiredFields = ['username', 'name', 'phone', 'password'];
      const missingFields = requiredFields.filter(field => !req.body[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
          missingFields
        });
      }

      // Validate password type and convert to string if needed
      if (typeof password !== 'string') {
        console.log(`Warning: Password received as ${typeof password}, converting to string`);
      }
      const passwordString = String(password);

      // Either association_no or partner_uid must be provided
      if (!association_no && !partner_uid) {
        return res.status(400).json({
          success: false,
          message: 'Either association_no or partner_uid must be provided'
        });
      }
      
      // Check if username already exists
      const existingUser = await User.findOne({ where: { username } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Username already exists'
        });
      }

      // Check if email already exists
      if (email) {
        const existingEmail = await User.findOne({ where: { email } });
        if (existingEmail) {
          return res.status(400).json({
            success: false,
            message: 'Email already exists'
          });
        }
      }
      
      // Check if phone already exists
      const existingPhone = await User.findOne({ where: { phone } });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already exists'
        });
      }

      let adminUser = null;
      let admin_id = null;

      // Look for admin user based on what was provided
      if (association_no) {
        // Check if association_no exists in the admin table (only active admins)
        adminUser = await User.findOne({ 
          where: { 
            id: association_no,
            type: 'admin',
            status: 1
          }
        });
        
        if (!adminUser) {
          return res.status(400).json({
            success: false,
            message: 'Invalid association number. Please enter a valid association number.'
          });
        }
        
        admin_id = association_no;
      } else if (partner_uid) {
        // Check if partner_uid exists and is an admin (only active admins)
        adminUser = await User.findOne({ 
          where: { 
            uid: partner_uid,
            type: 'admin',
            status: 1
          }
        });
        
        if (!adminUser) {
          return res.status(400).json({
            success: false,
            message: 'Invalid partner UID. Please enter a valid partner UID.'
          });
        }
        
        admin_id = adminUser.id;
      }

      const authToken = auth_token ? auth_token : uuidv4();

      const user = await User.create({
        admin_id: admin_id,
        name,
        email,
        phone,
        username,
        password: passwordString, // Use the string version
        type,
        uid,
        senderId,
        auth_token: authToken,
        country: country || null // Store country name if provided
      });

      const { jwtExpiry, cookieMaxAgeMs } = getSessionLifetimes(user.type);

      const token = jwt.sign(
        { id: user.id, type: user.type },
        process.env.JWT_SECRET,
        { expiresIn: jwtExpiry }
      );

      // Mark user as actively logged in
      activeUserSessions.setUserActive(user.id, user.type);

      // Fetch settings (same as login function)
      const settings = await Setting.findAll();
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});

      // Determine if this is a cross-origin request from an allowed white-label domain
      const origin = req.get('Origin') || req.get('Referer');
      const mainDomain = process.env.MAIN_DOMAIN || 'botmastersender.com';
      let isCrossOrigin = false;
      
      if (origin && !origin.includes(mainDomain)) {
        // Check if this origin is in our allowed white-label domains
        try {
          const url = new URL(origin);
          const hostname = url.hostname;
          
          const WhiteLabelConfig = require('../models/WhiteLabelConfig');
          const configs = await WhiteLabelConfig.findAll({
            attributes: ['domain_name']
          });
          
          const allowedDomains = configs.map(config => config.domain_name);
          const isAllowedDomain = allowedDomains.some(allowedDomain => 
            hostname === allowedDomain || hostname.endsWith('.' + allowedDomain)
          );
          
          isCrossOrigin = isAllowedDomain;
        } catch (error) {
          console.error('Error validating white-label domain during registration:', error);
          isCrossOrigin = false; // Reject if we can't validate
        }
      }
      
      // Set cookie options (same as login function)
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: isCrossOrigin ? 'none' : 'lax',
        maxAge: cookieMaxAgeMs,
        path: '/',
      };

      // Set domain dynamically based on request origin
      const cookieDomain = await getCookieDomain(req);
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }

      res.cookie('token', token, cookieOptions);

      // Log administrator login (if applicable)
      await logAdminLogin(user, req);
      // Log customer login (if applicable)
      await logCustomerLogin(user, req);

      // Add Partitioned attribute for cross-origin requests to prevent browser warnings
      if (isCrossOrigin && process.env.NODE_ENV === 'production') {
        const existingSetCookie = res.getHeader('Set-Cookie') || [];
        const cookies = Array.isArray(existingSetCookie) ? existingSetCookie : [existingSetCookie];
        const modifiedCookies = cookies.map(cookie => {
          if (typeof cookie === 'string' && cookie.startsWith('token=') && !cookie.includes('Partitioned')) {
            return cookie + '; Partitioned';
          }
          return cookie;
        });
        res.setHeader('Set-Cookie', modifiedCookies);
      }

      const userData = {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        uid: user.uid,
        isVerified: user.isVerified()
      };

      console.log(`Registration successful for user: ${user.name} (${user.id}) - Auto-login completed`);

      res.status(201).json({
        success: true,
        token,
        user: userData,
        settings: settingsMap,
        message: `Welcome ${user.name}! Your account has been created and you are now logged in.`
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error occurred during registration'
      });
    }
  },

  async login(req, res) {
    try {
      const { username, password, email, phone } = req.body;
      console.log('Login attempt for:', username || email || phone);
      
      let user;
      
      // Check if login is by username, email, or phone (only active users)
      if (username) {
        user = await User.findOne({ where: { username, status: 1 } });
      } else if (email) {
        user = await User.findOne({ where: { email, status: 1 } });
      } else if (phone) {
        user = await User.findOne({ where: { phone, status: 1 } });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Username, email, or phone is required'
        });
      }
      
      if (!user) {
        console.log('User not found or inactive:', username || email || phone);
        return res.status(404).json({
          success: false,
          message: 'Account not found or inactive. Please check your login details and try again.'
        });
      }

            // get user partner information we call partner as admin
            const partner = await User.findOne({ where: { id: user.admin_id , status: 1 } });
            if (!partner) {
              return res.status(404).json({
                success: false,
                message: 'No partner found for this user or account is inactive'
              });
            }

      console.log(`Attempting password validation for user: ${user.username} (ID: ${user.id})`);
      const isPasswordValid = await user.validatePassword(password);
      console.log(`Password validation result: ${isPasswordValid}`);
      
      if (isPasswordValid) {
        console.log(`Login successful for user: ${user.username} (ID: ${user.id})`);
        const { jwtExpiry, cookieMaxAgeMs } = getSessionLifetimes(user.type);

        const token = jwt.sign(
          { id: user.id, type: user.type },
          process.env.JWT_SECRET,
          { expiresIn: jwtExpiry }
        );

        // Mark user as actively logged in
        activeUserSessions.setUserActive(user.id, user.type);

        // Fetch settings
        const settings = await Setting.findAll();
        const settingsMap = settings.reduce((acc, setting) => {
          acc[setting.key] = setting.value;
          return acc;
        }, {});

        const defaultPermissions = await UserPermissions.findAll();

        // Determine if this is a cross-origin request from an allowed white-label domain
        const origin = req.get('Origin') || req.get('Referer');
        const mainDomain = process.env.MAIN_DOMAIN || 'botmastersender.com';
        let isCrossOrigin = false;
        
        if (origin && !origin.includes(mainDomain)) {
          // Check if this origin is in our allowed white-label domains
          try {
            const url = new URL(origin);
            const hostname = url.hostname;
            
            const WhiteLabelConfig = require('../models/WhiteLabelConfig');
            const configs = await WhiteLabelConfig.findAll({
              attributes: ['domain_name']
            });
            
            const allowedDomains = configs.map(config => config.domain_name);
            const isAllowedDomain = allowedDomains.some(allowedDomain => 
              hostname === allowedDomain || hostname.endsWith('.' + allowedDomain)
            );
            
            isCrossOrigin = isAllowedDomain;
          } catch (error) {
            console.error('Error validating white-label domain:', error);
            isCrossOrigin = false; // Reject if we can't validate
          }
        }
        
        // Debug logging
        console.log('🍪 Cookie Debug Info:');
        console.log('- Origin:', origin);
        console.log('- Main Domain:', mainDomain);
        console.log('- Is Cross Origin:', isCrossOrigin);
        console.log('- NODE_ENV:', process.env.NODE_ENV);
        
        // Set cookie options
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: isCrossOrigin ? 'none' : 'lax',
          maxAge: cookieMaxAgeMs,
          path: '/',
        };

        // Set domain dynamically based on request origin
        const cookieDomain = await getCookieDomain(req);
        if (cookieDomain) {
          cookieOptions.domain = cookieDomain;
        }
        
        console.log('- Cookie Options:', cookieOptions);
        console.log('- Cookie Domain:', cookieDomain);

        res.cookie('token', token, cookieOptions);

        // Add Partitioned attribute for cross-origin requests to prevent browser warnings
        if (isCrossOrigin && process.env.NODE_ENV === 'production') {
          const existingSetCookie = res.getHeader('Set-Cookie') || [];
          const cookies = Array.isArray(existingSetCookie) ? existingSetCookie : [existingSetCookie];
          const modifiedCookies = cookies.map(cookie => {
            if (typeof cookie === 'string' && cookie.startsWith('token=') && !cookie.includes('Partitioned')) {
              return cookie + '; Partitioned';
            }
            return cookie;
          });
          res.setHeader('Set-Cookie', modifiedCookies);
          console.log('- Final Set-Cookie Header (with Partitioned):', modifiedCookies);
        } else {
          console.log('- Final Set-Cookie Header:', res.getHeader('Set-Cookie'));
        }

        const userData = {
          id: user.id,
          name: user.name,
          email: user.email,
          type: user.type
        };

        // Log administrator login (if applicable)
        await logAdminLogin(user, req);
        // Log customer login (if applicable)
        await logCustomerLogin(user, req);

        res.json({
          success: true,
          user: userData,
          settings: settingsMap,
          token
        });
      } else {
        console.log('Invalid password for user:', username || email);
        res.status(401).json({
          success: false,
          message: 'Invalid password. Please check your password and try again.'
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Error during login',
        error: error.message
      });
    }
  },

  // UID-based login for project transfers
  async loginWithUID(req, res) {
    try {
      const { uid } = req.body;
      
      if (!uid) {
        return res.status(400).json({
          success: false,
          message: 'UID is required'
        });
      }

      console.log('UID login attempt for:', uid);
      
      // Find user by UID (only active users)
      const user = await User.findOne({ where: { uid, status: 1 } });
      
      if (!user) {
        console.log('User not found or inactive with UID:', uid);
        return res.status(404).json({
          success: false,
          message: 'Invalid UID, user not found, or account is inactive'
        });
      }

            // get user partner information we call partner as admin
            const partner = await User.findOne({ where: { id: user.admin_id , status: 1 } });
            if (!partner) {
              return res.status(404).json({
                success: false,
                message: 'No partner found for this user or account is inactive'
              });
            }

      // Determine session lifetimes based on user type
      const { jwtExpiry, cookieMaxAgeMs } = getSessionLifetimes(user.type);

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, type: user.type },
        process.env.JWT_SECRET,
        { expiresIn: jwtExpiry }
      );

      // Fetch settings
      const settings = await Setting.findAll();
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});

      // Determine if this is a cross-origin request from an allowed white-label domain
      const origin = req.get('Origin') || req.get('Referer');
      const mainDomain = process.env.MAIN_DOMAIN || 'botmastersender.com';
      let isCrossOrigin = false;
      
      if (origin && !origin.includes(mainDomain)) {
        // Check if this origin is in our allowed white-label domains
        try {
          const url = new URL(origin);
          const hostname = url.hostname;
          
          const WhiteLabelConfig = require('../models/WhiteLabelConfig');
          const configs = await WhiteLabelConfig.findAll({
            attributes: ['domain_name']
          });
          
          const allowedDomains = configs.map(config => config.domain_name);
          const isAllowedDomain = allowedDomains.some(allowedDomain => 
            hostname === allowedDomain || hostname.endsWith('.' + allowedDomain)
          );
          
          isCrossOrigin = isAllowedDomain;
        } catch (error) {
          console.error('Error validating white-label domain:', error);
          isCrossOrigin = false; // Reject if we can't validate
        }
      }
      
      // Set cookie options
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: isCrossOrigin ? 'none' : 'lax',
        maxAge: cookieMaxAgeMs,
        path: '/',
      };

      // Set domain dynamically based on request origin
      const cookieDomain = await getCookieDomain(req);
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }

      res.cookie('token', token, cookieOptions);

      // Log administrator login (if applicable)
      await logAdminLogin(user, req);
      // Log customer login (if applicable)
      await logCustomerLogin(user, req);

      // Add Partitioned attribute for cross-origin requests to prevent browser warnings
      if (isCrossOrigin && process.env.NODE_ENV === 'production') {
        const existingSetCookie = res.getHeader('Set-Cookie') || [];
        const cookies = Array.isArray(existingSetCookie) ? existingSetCookie : [existingSetCookie];
        const modifiedCookies = cookies.map(cookie => {
          if (typeof cookie === 'string' && cookie.startsWith('token=') && !cookie.includes('Partitioned')) {
            return cookie + '; Partitioned';
          }
          return cookie;
        });
        res.setHeader('Set-Cookie', modifiedCookies);
      }

      const userData = {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        uid: user.uid,
        isVerified: user.isVerified()
      };

      console.log(`UID login successful for user: ${user.name} (${user.id})`);

      res.json({
        success: true,
        user: userData,
        settings: settingsMap,
        token,
        message: `Welcome ${user.name}! You have been automatically logged in.`
      });
    } catch (error) {
      console.error('UID login error:', error);
      res.status(500).json({
        success: false,
        message: 'Error during UID login',
        error: error.message
      });
    }
  },

  async logout(req, res) {
    try {
      // Try to determine current user from token (if available)
      try {
        let token = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
          token = req.headers.authorization.replace('Bearer ', '');
        } else if (req.cookies && req.cookies.token) {
          token = req.cookies.token;
        }

        if (token) {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded && decoded.id) {
            // Normal logout: mark user as inactive but do NOT mark as force-logged-out
            // so that future logins work normally and we don’t accidentally
            // treat them as admin-terminated sessions.
            activeUserSessions.setUserInactive(decoded.id, { forceLogout: false });
          }
        }
      } catch (innerError) {
        // Do not block logout on token decode issues
        console.error('Logout token decode error:', innerError.message);
      }

      res.clearCookie('token');
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Error occurred during logout'
      });
    }
  },

  // New endpoint to check a single permission
  async checkPermission(req, res) {
    try {
      const { menuKey, permissionKey } = req.query;
      const userId = req.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let hasPermission = false;

      // Check if we're checking a menu permission or another type
      if (menuKey) {
        // For menu permissions
        hasPermission = user.permissions && 
                        user.permissions.menu && 
                        user.permissions.menu[menuKey] === true;
        
        // Special case: admin users always have access to admin menu
        if (menuKey === 'admin' && user.type === 'admin') {
          hasPermission = true;
        }
        
        // Dashboard is always accessible
        if (menuKey === 'dashboard') {
          hasPermission = true;
        }
      } else if (permissionKey) {
        // For other permissions
        hasPermission = user.permissions && 
                        user.permissions[permissionKey] === true;
      }

      return res.json({
        success: true,
        hasPermission
      });
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking permission',
        error: error.message
      });
    }
  },

  // New endpoint to check multiple permissions at once
  async checkPermissions(req, res) {
    try {
      const { menuKeys } = req.body;
      const userId = req.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      if (!menuKeys || !Array.isArray(menuKeys)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request. menuKeys array is required.'
        });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Create result object with permission status for each menu key
      const permissions = menuKeys.reduce((acc, key) => {
        // Special case: admin users always have access to admin menu
        if (key === 'admin' && user.type === 'admin') {
          acc[key] = true;
        } 
        // Dashboard is always accessible
        else if (key === 'dashboard') {
          acc[key] = true;
        }
        // Check regular menu permissions
        else {
          acc[key] = user.permissions && 
                    user.permissions.menu && 
                    user.permissions.menu[key] === true;
        }
        return acc;
      }, {});

      return res.json({
        success: true,
        permissions
      });
    } catch (error) {
      console.error('Multiple permissions check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking permissions',
        error: error.message
      });
    }
  },

  // Get all permissions for the current user
  async getPermissions(req, res) {
    try {
      const userId = req.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get user permissions or default permissions if not set
      const permissions = user.permissions || {
        menu: {
          admin: user.type === 'admin',
          customers: true,
          products: true,
          pos: true,
          pos_orders: true,
          transactions: true,
          sales_report: true
        }
      };

      // Ensure admin users always have admin menu access
      if (user.type === 'admin' && permissions.menu) {
        permissions.menu.admin = true;
      }

      // Ensure dashboard is always accessible
      if (permissions.menu) {
        permissions.menu.dashboard = true;
      }

      return res.json({
        success: true,
        permissions
      });
    } catch (error) {
      console.error('Get permissions error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error getting permissions',
        error: error.message
      });
    }
  },

  // Login as another user (for admin/administrator only)
  async loginAsUser(req, res) {
    try {
      const adminId = req.user.id;
      const { userId } = req.body;
      
      // Ensure the requester is an admin or administrator
      const admin = await User.findByPk(adminId);
      if (!admin || (admin.type !== 'admin' && admin.type !== 'administrator')) {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can use this feature'
        });
      }
      
      // Find the target user
      const targetUser = await User.findByPk(userId);
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Target user not found'
        });
      }
      
      // Impersonated sessions expire in 48 hours
      // This prevents orphaned impersonation sessions and provides adequate time for admin work
      const impersonationExpiry = '48h'; // 48 hours for all impersonation sessions
      
      // Generate JWT token with special flag indicating impersonation
      const token = jwt.sign(
        { 
          id: targetUser.id, 
          type: targetUser.type,
          impersonatedBy: adminId, // Add this to keep track of the admin
          isImpersonating: true
        },
        process.env.JWT_SECRET,
        { expiresIn: impersonationExpiry } // 48 hours for impersonation
      );

      // Mark target user as actively logged in (impersonated session)
      activeUserSessions.setUserActive(targetUser.id, targetUser.type);

      // Fetch settings
      const settings = await Setting.findAll();
      const settingsMap = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});

      // Determine if this is a cross-origin request from an allowed white-label domain
      const origin = req.get('Origin') || req.get('Referer');
      const mainDomain = process.env.MAIN_DOMAIN || 'botmastersender.com';
      let isCrossOrigin = false;
      
      if (origin && !origin.includes(mainDomain)) {
        // Check if this origin is in our allowed white-label domains
        try {
          const url = new URL(origin);
          const hostname = url.hostname;
          
          const WhiteLabelConfig = require('../models/WhiteLabelConfig');
          const configs = await WhiteLabelConfig.findAll({
            attributes: ['domain_name']
          });
          
          const allowedDomains = configs.map(config => config.domain_name);
          const isAllowedDomain = allowedDomains.some(allowedDomain => 
            hostname === allowedDomain || hostname.endsWith('.' + allowedDomain)
          );
          
          isCrossOrigin = isAllowedDomain;
        } catch (error) {
          console.error('Error validating white-label domain:', error);
          isCrossOrigin = false; // Reject if we can't validate
        }
      }
      
      // Set cookie options - impersonation cookies expire in 48 hours
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: isCrossOrigin ? 'none' : 'lax',
        maxAge: 48 * 60 * 60 * 1000, // 48 hours for impersonation sessions
        path: '/',
      };

      // Set domain dynamically based on request origin
      const cookieDomain = await getCookieDomain(req);
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }

      res.cookie('impersonation_token', token, cookieOptions);

      // Add Partitioned attribute for cross-origin requests to prevent browser warnings
      if (isCrossOrigin && process.env.NODE_ENV === 'production') {
        const existingSetCookie = res.getHeader('Set-Cookie') || [];
        const cookies = Array.isArray(existingSetCookie) ? existingSetCookie : [existingSetCookie];
        const modifiedCookies = cookies.map(cookie => {
          if (typeof cookie === 'string' && cookie.startsWith('impersonation_token=') && !cookie.includes('Partitioned')) {
            return cookie + '; Partitioned';
          }
          return cookie;
        });
        res.setHeader('Set-Cookie', modifiedCookies);
      }

      const userData = {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        type: targetUser.type,
        isImpersonating: true,
        impersonatedBy: {
          id: admin.id,
          name: admin.name,
          type: admin.type
        }
      };

      return res.json({
        success: true,
        user: userData,
        settings: settingsMap,
        token,
        message: `You are now logged in as ${targetUser.name}`
      });
    } catch (error) {
      console.error('Login as user error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error during login as user',
        error: error.message
      });
    }
  },

  // End impersonation and return to admin account
  async endImpersonation(req, res) {
    try {
      // No need for complex token exchanges - the client will handle restoring 
      // the admin token which was stored before impersonation
      return res.status(200).json({
        success: true,
        message: 'Impersonation ended successfully'
      });
    } catch (error) {
      console.error('Error ending impersonation:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error ending impersonation' 
      });
    }
  },

  // Validate field for real-time form validation
  async validateField(req, res) {
    try {
      const { field, value, context } = req.query; // Added context parameter
      
      if (!field || !value) {
        return res.status(400).json({
          valid: false,
          message: 'Field and value are required'
        });
      }
      
      let valid = true;
      let message = '';
      const isLogin = context === 'login'; // Check if this is for login validation
      
      switch (field) {
        case 'username':
          if (isLogin) {
            // For login: check active users only
            const existingUser = await User.findOne({ where: { username: value, status: 1 } });
            if (!existingUser) {
              valid = false;
              message = 'Username not found or account inactive';
            }
          } else {
            // For registration: check all users to prevent duplicates
            const existingUser = await User.findOne({ where: { username: value } });
            if (existingUser) {
              valid = false;
              message = 'Username already taken';
            }
          }
          break;
          
        case 'email':
          if (isLogin) {
            // For login: check active users only
            const existingEmail = await User.findOne({ where: { email: value, status: 1 } });
            if (!existingEmail) {
              valid = false;
              message = 'Email not found or account inactive';
            }
          } else {
            // For registration: check all users to prevent duplicates
            const existingEmail = await User.findOne({ where: { email: value } });
            if (existingEmail) {
              valid = false;
              message = 'Email already registered';
            }
          }
          break;
          
          case 'phone':
          if (isLogin) {
            // For login: check active users only
            const existingPhone = await User.findOne({ where: { phone: value, status: 1 } });
            if (!existingPhone) {
              valid = false;
              message = 'Phone number not found or account inactive';
            }
          } else {
            // For registration: check all users to prevent duplicates
            const existingPhone = await User.findOne({ where: { phone: value } });
            if (existingPhone) {
              valid = false;
              message = 'Phone already taken';
            }
          }
          break;
          
        case 'association_no':
          const adminUser = await User.findOne({ 
            where: { 
              id: value,
              type: 'admin',
              status: 1
            }
          });
          
          if (!adminUser) {
            valid = false;
            message = 'Invalid association number or admin account is inactive';
          }
          break;
          
        default:
          valid = false;
          message = 'Invalid field to validate';
      }
      
      return res.json({
        valid,
        message
      });
    } catch (error) {
      console.error('Field validation error:', error);
      return res.status(500).json({
        valid: false,
        message: 'Error validating field'
      });
    }
  },
};

module.exports = authController; 