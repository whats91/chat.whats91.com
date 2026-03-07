#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Deploy script for whats91.com
 * Uses spawn with completely isolated environment
 * Sends WhatsApp notifications on deployment completion
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

// Load .env file at the very beginning
function loadEnvFile() {
  // Try multiple paths for .env file
  const possiblePaths = [
    path.join(__dirname, '..', '.env'),        // scripts/../.env
    path.join(process.cwd(), '.env'),          // CWD/.env
    '/home/whats91/htdocs/whats91.com/.env',   // Absolute path
  ];
  
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      console.log(`[deploy] Loading .env from: ${envPath}`);
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
            // Only set if not already defined
            if (!process.env[key.trim()]) {
              process.env[key.trim()] = value;
            }
          }
        }
      });
      console.log(`[deploy] Loaded env vars, BOT_MASTER_AUTH_TOKEN=${process.env.BOT_MASTER_AUTH_TOKEN ? 'SET' : 'NOT SET'}`);
      return; // Successfully loaded, exit
    }
  }
  console.log("[deploy] Warning: .env file not found in any location");
}

// Load env before config
loadEnvFile();

// ====== CONFIG ======
const CONFIG = {
  projectPath: process.env.GITHUB_WEBHOOK_PROJECT_PATH || "/home/whats91/htdocs/whats91.com",
  tempPath: process.env.DEPLOY_TEMP_PATH || "/home/whats91/htdocs/whats91.com/temp",
  repoUrl: process.env.DEPLOY_REPO_URL || "https://github.com/travel-dev82/whats91.com.git",
  branch: process.env.GITHUB_WEBHOOK_BRANCH || "main",
  delayMs: 5000,
  pm2RestartCmd: "pm2 restart all",
  lockFile: "/home/whats91/htdocs/whats91.com/.deploy.lock",

  // Bot Master Sender API config for notifications
  botMaster: {
    apiUrl: process.env.BOT_MASTER_API_URL || "https://api.botmastersender.com/api/v1/?action=send",
    senderId: process.env.BOT_MASTER_SENDER_ID || "919425004029",
    receiverId: process.env.BOT_MASTER_RECEIVER_ID || "917000782082",
    authToken: process.env.BOT_MASTER_AUTH_TOKEN || "",
  },

  copyFolders: ["src", "prisma", "scripts", "public"],
  copyFiles: [
    "package.json",
    "package-lock.json",
    "postcss.config.js",
    "postcss.config.cjs",
    "postcss.config.mjs",
    "tailwind.config.js",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
    "tailwind.config.ts",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "version.txt",
  ],
};

// ====== Logging ======
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(message, color = "reset") {
  const ts = new Date().toISOString();
  console.log(`${colors[color]}[${ts}] [deploy] ${message}${colors.reset}`);
}

function logSection(title) {
  console.log("");
  log("═".repeat(60), "bright");
  log(`  ${title}`, "bright");
  log("═".repeat(60), "bright");
  console.log("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deployment lock functions to prevent concurrent deployments
 */
function acquireLock() {
  if (fs.existsSync(CONFIG.lockFile)) {
    const lockData = JSON.parse(fs.readFileSync(CONFIG.lockFile, 'utf-8'));
    const lockAge = Date.now() - new Date(lockData.timestamp).getTime();
    
    // If lock is older than 30 minutes, it's stale - remove it
    if (lockAge > 30 * 60 * 1000) {
      log("Found stale lock file (older than 30 min), removing...", "yellow");
      fs.unlinkSync(CONFIG.lockFile);
    } else {
      return false;
    }
  }
  
  // Create lock file
  fs.writeFileSync(CONFIG.lockFile, JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
  }));
  log(`Lock acquired: ${CONFIG.lockFile}`, "green");
  return true;
}

function releaseLock() {
  if (fs.existsSync(CONFIG.lockFile)) {
    fs.unlinkSync(CONFIG.lockFile);
    log("Lock released", "green");
  }
}

/**
 * Run a command with CLEAN environment
 * CRITICAL: Explicitly set PATH and HOME to ensure npm/node work correctly
 */
function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    log(`Running: ${command} ${args.join(" ")}`, "cyan");
    log(`  CWD: ${cwd}`, "magenta");
    
    // Build a CLEAN environment - don't inherit potentially polluted vars
    const cleanEnv = {
      HOME: process.env.HOME || "/home/whats91",
      USER: process.env.USER || "whats91",
      PATH: process.env.PATH,
      NODE_PATH: process.env.NODE_PATH,
      NVM_DIR: process.env.NVM_DIR,
      NVM_INC: process.env.NVM_INC,
      GITHUB_WEBHOOK_PROJECT_PATH: CONFIG.projectPath,
    };
    
    // Add NVM path if available
    if (process.env.NVM_DIR) {
      cleanEnv.PATH = `${process.env.NVM_DIR}/versions/node/v20.19.0/bin:${cleanEnv.PATH}`;
    }
    
    log(`  PATH: ${cleanEnv.PATH?.substring(0, 100)}...`, "magenta");
    log(`  HOME: ${cleanEnv.HOME}`, "magenta");
    
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: cleanEnv,
      shell: true,
    });
    
    child.on("error", (error) => {
      log(`Process error: ${error.message}`, "red");
      reject(error);
    });
    
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal });
      } else {
        const error = new Error(`Command failed with code ${code}, signal ${signal}`);
        error.code = code;
        reject(error);
      }
    });
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`Created directory: ${dir}`, "yellow");
  }
}

function copyFolderClean(src, dest) {
  if (src.includes("node_modules") || dest.includes("node_modules")) {
    throw new Error(`Safety: node_modules path detected`);
  }

  if (!fs.existsSync(src)) {
    throw new Error(`Source folder not found: ${src}`);
  }

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.cpSync(src, dest, { recursive: true });
  log(`Copied folder: ${src} -> ${dest}`, "green");
}

function copyFileIfExists(src, dest) {
  if (src.includes("node_modules") || dest.includes("node_modules")) {
    return false;
  }
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dest);
  log(`Copied file: ${path.basename(src)}`, "green");
  return true;
}

function clearCacheFolders() {
  log("Clearing all cache folders...", "yellow");
  
  const cachePaths = [
    ".next",
    "node_modules/.cache",
    "node_modules/.prisma",
    "node_modules/@prisma/client",
  ];

  for (const relPath of cachePaths) {
    const fullPath = path.join(CONFIG.projectPath, relPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      log(`Cleared: ${relPath}`, "green");
    } else {
      log(`Not found (skip): ${relPath}`, "cyan");
    }
  }
}

/**
 * Read version from version.txt
 */
function getVersion() {
  try {
    const versionPath = path.join(CONFIG.projectPath, "version.txt");
    if (fs.existsSync(versionPath)) {
      return fs.readFileSync(versionPath, "utf-8").trim();
    }
  } catch (err) {
    log(`Could not read version.txt: ${err.message}`, "yellow");
  }
  return "?.?.?";
}

/**
 * Get current git commit info from temp folder
 */
function getGitInfo() {
  try {
    const commitHash = require("child_process")
      .execSync(`git -C "${CONFIG.tempPath}" rev-parse --short HEAD`, { encoding: "utf-8" })
      .trim();
    const commitMsg = require("child_process")
      .execSync(`git -C "${CONFIG.tempPath}" log -1 --pretty=%s`, { encoding: "utf-8" })
      .trim();
    return { hash: commitHash, message: commitMsg };
  } catch (err) {
    return { hash: "unknown", message: "unknown" };
  }
}

/**
 * Send WhatsApp notification via Bot Master Sender API
 */
async function sendDeploymentNotification(status, data) {
  const { botMaster } = CONFIG;
  
  // Debug: Log if auth token exists (masked)
  const tokenStatus = botMaster.authToken ? `set (${botMaster.authToken.substring(0, 8)}...)` : 'NOT SET';
  log(`Bot Master config: senderId=${botMaster.senderId}, receiverId=${botMaster.receiverId}, authToken=${tokenStatus}`, "cyan");
  
  if (!botMaster.authToken) {
    log("Bot Master auth token not configured, skipping notification", "yellow");
    return;
  }

  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const version = getVersion();
  const gitInfo = getGitInfo();
  
  let messageText;
  
  if (status === "success") {
    messageText = `✅ *Deployment Successful*

🚀 *whats91.com* deployed successfully!
━━━━━━━━━━━━━━━━━━━━
📦 *Version:* v${version}
🔗 *Commit:* \`${gitInfo.hash}\`
📝 *Message:* ${gitInfo.message}
⏱️ *Duration:* ${data.duration}s
━━━━━━━━━━━━━━━━━━━━

📅 *Deployed:* ${timestamp}
🌐 *Branch:* ${CONFIG.branch}`;
  } else {
    messageText = `❌ *Deployment Failed*

⚠️ *whats91.com* deployment encountered an error!
━━━━━━━━━━━━━━━━━━━━
📦 *Version:* v${version}
🔗 *Commit:* \`${gitInfo.hash}\`
📝 *Message:* ${gitInfo.message}
━━━━━━━━━━━━━━━━━━━━

🔴 *Error:*
\`\`\`
${data.error.substring(0, 500)}${data.error.length > 500 ? "..." : ""}
\`\`\`

📅 *Failed at:* ${timestamp}
🌐 *Branch:* ${CONFIG.branch}

⚡ *Action Required:* Check deployment logs immediately.`;
  }

  const payload = JSON.stringify({
    senderId: botMaster.senderId,
    receiverId: botMaster.receiverId,
    messageText: messageText,
    authToken: botMaster.authToken,
  });

  // Log request details (with masked token)
  log(`Sending notification to: ${botMaster.apiUrl}`, "cyan");
  log(`Payload (masked): senderId=${botMaster.senderId}, receiverId=${botMaster.receiverId}, messageText.length=${messageText.length}`, "magenta");

  return new Promise((resolve) => {
    const url = new URL(botMaster.apiUrl);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        // Log full API response for debugging
        log(`API Response Status: ${res.statusCode}`, "cyan");
        log(`API Response Headers: ${JSON.stringify(res.headers)}`, "magenta");
        log(`API Response Body: ${body}`, "cyan");
        
        if (res.statusCode === 200) {
          log("WhatsApp notification sent successfully", "green");
        } else {
          log(`WhatsApp notification failed: ${res.statusCode} ${body}`, "yellow");
        }
        resolve();
      });
    });

    req.on("error", (err) => {
      log(`WhatsApp notification error: ${err.message}`, "red");
      log(`Error stack: ${err.stack}`, "red");
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

async function deploy() {
  const start = Date.now();
  
  // Try to acquire deployment lock
  if (!acquireLock()) {
    logSection("DEPLOYMENT SKIPPED");
    log("Another deployment is already in progress. Exiting.", "yellow");
    process.exit(0);
  }
  
  // Ensure lock is released on exit
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
  
  logSection("DEPLOYMENT STARTING");
  
  // Log environment info
  log("Environment Information:", "bright");
  log(`  Process CWD: ${process.cwd()}`, "magenta");
  log(`  Project Path: ${CONFIG.projectPath}`, "magenta");
  log(`  Temp Path: ${CONFIG.tempPath}`, "magenta");
  log(`  Branch: ${CONFIG.branch}`, "magenta");
  log(`  Node Version: ${process.version}`, "magenta");
  log(`  USER: ${process.env.USER || 'not set'}`, "magenta");
  log(`  HOME: ${process.env.HOME || 'not set'}`, "magenta");
  log(`  PATH: ${process.env.PATH?.substring(0, 100)}...`, "magenta");
  
  // Verify project path exists
  if (!fs.existsSync(CONFIG.projectPath)) {
    releaseLock();
    throw new Error(`Project path does not exist: ${CONFIG.projectPath}`);
  }

  try {
    // STEP 1: Pull to temp
    logSection("STEP 1: Pull latest code into temp folder");
    ensureDir(CONFIG.tempPath);

    const tempGitDir = path.join(CONFIG.tempPath, ".git");
    if (!fs.existsSync(tempGitDir)) {
      log("Temp folder is not a git repo. Initializing...", "cyan");
      await runCommand("git", ["init"], CONFIG.tempPath);
      await runCommand("git", ["remote", "add", "origin", CONFIG.repoUrl], CONFIG.tempPath);
    }

    await runCommand("git", ["remote", "set-url", "origin", CONFIG.repoUrl], CONFIG.tempPath);
    await runCommand("git", ["fetch", "origin", CONFIG.branch], CONFIG.tempPath);
    await runCommand("git", ["reset", "--hard", `origin/${CONFIG.branch}`], CONFIG.tempPath);
    await runCommand("git", ["log", "-1", "--oneline"], CONFIG.tempPath);

    log(`Waiting ${CONFIG.delayMs / 1000}s...`, "cyan");
    await sleep(CONFIG.delayMs);

    // STEP 2: Copy folders/files to production
    logSection("STEP 2: Copy updated code to production");

    for (const folder of CONFIG.copyFolders) {
      const src = path.join(CONFIG.tempPath, folder);
      const dest = path.join(CONFIG.projectPath, folder);
      try {
        copyFolderClean(src, dest);
      } catch (err) {
        log(`Warning: Could not copy folder ${folder}: ${err.message}`, "yellow");
      }
    }

    for (const file of CONFIG.copyFiles) {
      const src = path.join(CONFIG.tempPath, file);
      const dest = path.join(CONFIG.projectPath, file);
      copyFileIfExists(src, dest);
    }

    log(`Waiting ${CONFIG.delayMs / 1000}s...`, "cyan");
    await sleep(CONFIG.delayMs);

    // STEP 3: Clear ALL caches
    logSection("STEP 3: Clear all caches");
    clearCacheFolders();

    log(`Waiting ${CONFIG.delayMs / 1000}s...`, "cyan");
    await sleep(CONFIG.delayMs);

    // STEP 4: npm install
    logSection("STEP 4: npm install");
    const installStart = Date.now();
    await runCommand("npm", ["install"], CONFIG.projectPath);
    const installSecs = ((Date.now() - installStart) / 1000).toFixed(2);
    log(`npm install completed in ${installSecs}s`, "green");

    log(`Waiting ${CONFIG.delayMs / 1000}s...`, "cyan");
    await sleep(CONFIG.delayMs);

    // STEP 5: Build
    logSection("STEP 5: npm run build");
    const buildStart = Date.now();
    await runCommand("npm", ["run", "build"], CONFIG.projectPath);
    const buildSecs = ((Date.now() - buildStart) / 1000).toFixed(2);
    log(`Build completed in ${buildSecs}s`, "green");

    // STEP 6: Restart PM2
    logSection("STEP 6: pm2 restart");
    await runCommand(CONFIG.pm2RestartCmd, [], CONFIG.projectPath);

    // Small delay to ensure PM2 restart completes
    await sleep(2000);

    const totalSecs = ((Date.now() - start) / 1000).toFixed(2);
    logSection("DEPLOYMENT SUCCESSFUL");
    log(`Total time: ${totalSecs}s`, "green");
    
    // Send success notification
    log("Sending deployment notification...", "cyan");
    await sendDeploymentNotification("success", { duration: totalSecs });
    
    log("Deployment complete, exiting...", "green");
    process.exit(0);
  } catch (err) {
    const totalSecs = ((Date.now() - start) / 1000).toFixed(2);
    logSection("DEPLOYMENT FAILED");
    log(`Error: ${err.message}`, "red");
    if (err.stack) {
      log(`Stack: ${err.stack}`, "red");
    }
    log(`Total time: ${totalSecs}s`, "red");
    
    // Send failure notification
    log("Sending failure notification...", "cyan");
    await sendDeploymentNotification("failed", { 
      error: err.message,
      duration: totalSecs 
    });
    
    log("Deployment failed, exiting...", "red");
    process.exit(1);
  }
}

deploy();
