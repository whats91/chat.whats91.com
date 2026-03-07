const { Sequelize } = require('sequelize');
require('dotenv').config({ path: './.env' });
const config = require('./config');
const dbLogger = require('./db-load-log');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    port: process.env.DB_PORT || 3306,
    logging: false,
    timezone: '+05:30', // Set timezone to Indian Standard Time (IST)
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// ========================================
// DATABASE QUERY LOGGING SETUP
// ========================================
// Enable or disable query logging based on config
dbLogger.setEnabled(config.enableQueryLogging);

if (config.enableQueryLogging) {
  console.log('🔍 Database query logging is ENABLED');
  
  // Hook into all queries before they execute
  sequelize.addHook('beforeQuery', (options) => {
    options.startTime = Date.now();
  });

  // Hook into all queries after they execute
  sequelize.addHook('afterQuery', (options, query) => {
    const executionTime = Date.now() - options.startTime;
    
    // Get model name if available
    const modelName = options.model?.name || 'Unknown';
    const methodName = options.type || 'Unknown';
    
    dbLogger.logQueryWithContext(
      query.sql || 'Query not available',
      executionTime,
      {
        model: modelName,
        method: methodName,
        bindParameters: query.bind
      }
    );
  });

  // Also log raw queries if logging is enabled
  sequelize.options.logging = (sql, timing) => {
    if (timing) {
      dbLogger.logQuery(sql, timing);
    } else {
      // If timing isn't available, use 0 as placeholder
      dbLogger.logQuery(sql, 0);
    }
  };
} else {
  console.log('🔕 Database query logging is DISABLED');
  sequelize.options.logging = false;
}

// Test the connection
sequelize.authenticate()
  .then(() => {
    console.log('Database connection has been established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });

module.exports = sequelize; 