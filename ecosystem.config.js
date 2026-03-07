/**
 * PM2 Ecosystem Configuration for Whats91 Chat
 * 
 * Usage:
 *   npm run pm2:start    - Start the application
 *   npm run pm2:stop     - Stop the application
 *   npm run pm2:restart  - Restart the application
 *   npm run pm2:logs     - View logs
 *   npm run pm2:status   - View status
 * 
 * CloudPanel Integration:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 stop ecosystem.config.js
 *   pm2 restart ecosystem.config.js
 * 
 * First-time setup:
 *   1. npm install
 *   2. npm run build
 *   3. cp .env.example .env
 *   4. Edit .env with your configuration
 *   5. pm2 start ecosystem.config.js --env production
 *   6. pm2 save
 *   7. pm2 startup (to run on system boot)
 */

module.exports = {
  apps: [
    {
      name: 'whats91-chat',
      
      // Use the start script that loads env variables
      script: 'scripts/start-with-env.js',
      
      // Production path (update this to your actual deployment path)
      cwd: process.env.PWD || process.cwd(),
      
      // Environment
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      
      // Process Management
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      
      // Logging - Use relative paths for portability
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 5000,
      
      // Auto restart on crash
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Cron restart (optional - restart at 3 AM daily)
      // cron_restart: '0 3 * * *',
    },
  ],
};
