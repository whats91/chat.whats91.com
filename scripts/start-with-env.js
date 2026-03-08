#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Whats91 Chat - Production Start Script
 * 
 * This script:
 * 1. Loads environment variables from .env file
 * 2. Validates required configuration
 * 3. Starts the Next.js standalone server
 * 
 * Usage:
 *   node scripts/start-with-env.js
 * 
 * With PM2:
 *   pm2 start ecosystem.config.js --env production
 */

const path = require('path');
const fs = require('fs');

// Get the project root directory
const projectRoot = path.resolve(__dirname, '..');

console.log('');
console.log('========================================');
console.log('  Whats91 Chat - Production Server');
console.log('========================================');
console.log(`[Startup] Project root: ${projectRoot}`);
console.log(`[Startup] Node version: ${process.version}`);
console.log(`[Startup] NODE_ENV: ${process.env.NODE_ENV || 'production'}`);
console.log('');

/**
 * Load environment variables from .env file
 */
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return false;
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    let loadedCount = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      // Parse KEY=VALUE
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Always set from .env file (overriding system defaults)
      process.env[key] = value;
      loadedCount++;
    }

    console.log(`[Startup] Loaded ${loadedCount} variables from ${path.basename(envPath)}`);
    return true;
  } catch (error) {
    console.error(`[Startup] Error loading ${envPath}: ${error.message}`);
    return false;
  }
}

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const requiredVars = [];
  const recommendedVars = [
    'DATABASE_URL',
    'NEXT_PUBLIC_APP_URL',
  ];
  const recommendedAnyOf = [
    ['AUTH_SESSION_SECRET', 'NEXTAUTH_SECRET'],
  ];
  
  // Check required variables
  const missingRequired = requiredVars.filter(v => !process.env[v]);
  if (missingRequired.length > 0) {
    console.error(`[Startup] ERROR: Missing required environment variables: ${missingRequired.join(', ')}`);
    process.exit(1);
  }
  
  // Check recommended variables
  const missingRecommended = recommendedVars.filter(v => !process.env[v]);
  if (missingRecommended.length > 0) {
    console.warn(`[Startup] Warning: Missing recommended environment variables: ${missingRecommended.join(', ')}`);
  }

  const missingRecommendedGroups = recommendedAnyOf
    .filter((group) => !group.some((key) => process.env[key]))
    .map((group) => group.join(' or '));
  if (missingRecommendedGroups.length > 0) {
    console.warn(`[Startup] Warning: Missing recommended auth secrets: ${missingRecommendedGroups.join(', ')}`);
  }
  
  console.log('[Startup] Environment validation passed');
}

// ========================================
// Main Execution
// ========================================

// Set NODE_ENV if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

// Load .env files in order of precedence
const nodeEnv = process.env.NODE_ENV;
const envFiles = [
  path.join(projectRoot, `.env.${nodeEnv}.local`),
  path.join(projectRoot, `.env.${nodeEnv}`),
  path.join(projectRoot, '.env.local'),
  path.join(projectRoot, '.env'),
];

let envLoaded = false;
for (const envFile of envFiles) {
  if (loadEnvFile(envFile)) {
    envLoaded = true;
    break; // Stop after first found
  }
}

if (!envLoaded) {
  console.warn('[Startup] Warning: No .env file found. Using system environment variables only.');
}

// Validate environment
validateEnvironment();

// Set default PORT
process.env.PORT = process.env.PORT || '3000';

console.log(`[Startup] Server will run on port: ${process.env.PORT}`);
console.log(`[Startup] LOG_LEVEL: ${process.env.LOG_LEVEL || 'debug (default)'}`);
console.log('');

// Check if server file exists
const serverPath = path.join(projectRoot, '.next', 'standalone', 'server.js');

if (!fs.existsSync(serverPath)) {
  console.error(`[Startup] ERROR: Server not found at ${serverPath}`);
  console.error('[Startup] Please run "npm run build" first.');
  process.exit(1);
}

// Check if static files exist
const staticPath = path.join(projectRoot, '.next', 'standalone', '.next', 'static');
if (!fs.existsSync(staticPath)) {
  console.warn('[Startup] Warning: Static files not found. Some assets may not load correctly.');
}

console.log('[Startup] Starting Next.js server...');
console.log('');

// Start the server
try {
  require(serverPath);
} catch (error) {
  console.error('[Startup] Failed to start server:', error.message);
  process.exit(1);
}
