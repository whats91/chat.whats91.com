/**
 * Logger utility for standardized terminal logging
 * Formats: 
 * - Without user ID: 2026-01-13 10:00:53 [INFO]: message
 * - With user ID: 2026-01-13 10:00:53 209 [INFO]: message
 */

/**
 * Get formatted timestamp
 * @returns {string} Formatted date and time (YYYY-MM-DD HH:mm:ss)
 */
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Log message without user ID
 * @param {string} level - Log level (INFO, WARN, ERROR, etc.)
 * @param {string} message - Log message
 */
function log(level, message) {
  const timestamp = getTimestamp();
  console.log(`${timestamp} [${level.toUpperCase()}]: ${message}`);
}

/**
 * Log message with user ID
 * @param {string} level - Log level (INFO, WARN, ERROR, etc.)
 * @param {string} message - Log message
 * @param {number|string} userId - User ID
 */
function logWithUserId(level, message, userId) {
  const timestamp = getTimestamp();
  console.log(`${timestamp} ${userId} [${level.toUpperCase()}]: ${message}`);
}

/**
 * Info level log without user ID
 * @param {string} message - Log message
 */
function info(message) {
  log('INFO', message);
}

/**
 * Info level log with user ID
 * @param {string} message - Log message
 * @param {number|string} userId - User ID
 */
function infoWithUserId(message, userId) {
  logWithUserId('INFO', message, userId);
}

/**
 * Warning level log without user ID
 * @param {string} message - Log message
 */
function warn(message) {
  log('WARN', message);
}

/**
 * Warning level log with user ID
 * @param {string} message - Log message
 * @param {number|string} userId - User ID
 */
function warnWithUserId(message, userId) {
  logWithUserId('WARN', message, userId);
}

/**
 * Error level log without user ID
 * @param {string} message - Log message
 */
function error(message) {
  log('ERROR', message);
}

/**
 * Error level log with user ID
 * @param {string} message - Log message
 * @param {number|string} userId - User ID
 */
function errorWithUserId(message, userId) {
  logWithUserId('ERROR', message, userId);
}

/**
 * Success level log without user ID
 * @param {string} message - Log message
 */
function success(message) {
  log('SUCCESS', message);
}

/**
 * Success level log with user ID
 * @param {string} message - Log message
 * @param {number|string} userId - User ID
 */
function successWithUserId(message, userId) {
  logWithUserId('SUCCESS', message, userId);
}

/**
 * WebSocket logger wrapper - logs to terminal and sends to WebSocket if available
 * Automatically converts userId to string for WebSocket compatibility
 * @param {string} level - Log level (info, error, warn, success)
 * @param {string} message - Log message
 * @param {number|string} userId - User ID (optional, defaults to 'system')
 */
function websocket(level, message, userId = null) {
  // Convert userId to string for WebSocket, default to 'system'
  const logId = String(userId || 'system');
  
  // Log to terminal with userId if provided
  if (userId) {
    logWithUserId(level.toUpperCase(), message, userId);
  } else {
    log(level.toUpperCase(), message);
  }
  
  // Send to WebSocket if available
  if (global.websocketLogger) {
    global.websocketLogger(level, message, logId);
  }
}

/**
 * WebSocket info log
 * @param {string} message - Log message
 * @param {number|string} userId - User ID (optional)
 */
function websocketInfo(message, userId = null) {
  websocket('info', message, userId);
}

/**
 * WebSocket error log
 * @param {string} message - Log message
 * @param {number|string} userId - User ID (optional)
 */
function websocketError(message, userId = null) {
  websocket('error', message, userId);
}

/**
 * WebSocket warning log
 * @param {string} message - Log message
 * @param {number|string} userId - User ID (optional)
 */
function websocketWarn(message, userId = null) {
  websocket('warn', message, userId);
}

/**
 * WebSocket success log
 * @param {string} message - Log message
 * @param {number|string} userId - User ID (optional)
 */
function websocketSuccess(message, userId = null) {
  websocket('success', message, userId);
}

/**
 * WebSocket debug log
 * Use this for debugging information that customers might need to see
 * This helps with troubleshooting without exposing critical internal logs
 * @param {string} message - Log message
 * @param {number|string} userId - User ID (optional)
 */
function websocketDebug(message, userId = null) {
  websocket('debug', message, userId);
}

module.exports = {
  log,
  logWithUserId,
  info,
  infoWithUserId,
  warn,
  warnWithUserId,
  error,
  errorWithUserId,
  success,
  successWithUserId,
  websocket,
  websocketInfo,
  websocketError,
  websocketWarn,
  websocketSuccess,
  websocketDebug
};
