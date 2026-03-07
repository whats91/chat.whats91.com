/**
 * Logger Utility
 * 
 * Provides consistent, timestamped console logging for debugging across the application.
 * Log levels: debug, info, warn, error
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Message received', { id: 123 });
 *   logger.error('Failed to connect', error);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  [key: string]: unknown;
}

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m',   // Cyan
  info: '\x1b[32m',    // Green
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  timestamp: '\x1b[90m', // Gray
  context: '\x1b[35m', // Magenta
};

// Log level priority (higher = more important)
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Gets the minimum log level from environment (read at runtime for reliability)
 */
function getMinLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return 'debug'; // Default: show all logs
}

/**
 * Formats the current timestamp as YYYY-MM-DD HH:mm:ss.SSS
 */
function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Checks if a log level should be displayed based on minimum level
 */
function shouldLog(level: LogLevel): boolean {
  const minLevel = getMinLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}

/**
 * Formats and outputs a log message to the console
 */
function log(level: LogLevel, context: string, message: string, meta?: LogMeta): void {
  if (!shouldLog(level)) return;

  const timestamp = formatTimestamp();
  const levelUpper = level.toUpperCase().padEnd(5);
  const contextPadded = context ? `[${context}]` : '';

  // Build the log prefix with colors
  const coloredTimestamp = `${COLORS.timestamp}${timestamp}${COLORS.reset}`;
  const coloredLevel = `${COLORS[level]}${levelUpper}${COLORS.reset}`;
  const coloredContext = context ? `${COLORS.context}${contextPadded}${COLORS.reset} ` : '';

  const prefix = `${coloredTimestamp} ${coloredLevel} ${coloredContext}`;
  const fullMessage = prefix + message;

  // Use only console.log, console.warn, console.error
  // console.debug is suppressed in Node.js production mode
  if (level === 'error') {
    if (meta !== undefined) {
      console.error(fullMessage, meta);
    } else {
      console.error(fullMessage);
    }
  } else if (level === 'warn') {
    if (meta !== undefined) {
      console.warn(fullMessage, meta);
    } else {
      console.warn(fullMessage);
    }
  } else {
    // debug and info both use console.log (console.debug is unreliable in prod)
    if (meta !== undefined) {
      console.log(fullMessage, meta);
    } else {
      console.log(fullMessage);
    }
  }
}

/**
 * Logger instance with context-aware logging
 */
class Logger {
  private context: string;

  constructor(context: string = 'App') {
    this.context = context;
  }

  /**
   * Create a child logger with a specific context
   * Useful for module-specific logging
   */
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }

  /**
   * Debug level - for detailed debugging information
   * Use for: variable values, flow tracking, detailed state
   */
  debug(message: string, meta?: LogMeta): void {
    log('debug', this.context, message, meta);
  }

  /**
   * Info level - for general operational information
   * Use for: startup messages, successful operations, milestones
   */
  info(message: string, meta?: LogMeta): void {
    log('info', this.context, message, meta);
  }

  /**
   * Warning level - for potentially problematic situations
   * Use for: deprecated features, unexpected but handled conditions
   */
  warn(message: string, meta?: LogMeta): void {
    log('warn', this.context, message, meta);
  }

  /**
   * Error level - for errors and exceptions
   * Use for: caught exceptions, failed operations, critical issues
   */
  error(message: string, meta?: LogMeta): void {
    log('error', this.context, message, meta);
  }
}

// Export a default logger instance
export const logger = new Logger('App');

// Export the Logger class for creating context-specific loggers
export { Logger };

// Export convenience functions for quick logging without context
export const logDebug = (message: string, meta?: LogMeta) => log('debug', '', message, meta);
export const logInfo = (message: string, meta?: LogMeta) => log('info', '', message, meta);
export const logWarn = (message: string, meta?: LogMeta) => log('warn', '', message, meta);
export const logError = (message: string, meta?: LogMeta) => log('error', '', message, meta);

// Export types
export type { LogLevel, LogMeta };
