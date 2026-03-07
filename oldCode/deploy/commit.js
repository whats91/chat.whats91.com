#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Git Commit with Auto Version Bump
 * 
 * Usage:
 *   bun run commit "your commit message"           # Patch bump (default)
 *   bun run commit "feat: your message" --minor    # Minor bump (new feature)
 *   bun run commit "fix: your message"             # Patch bump (auto-detected)
 *   bun run commit "breaking: your message" --major # Major bump
 *   bun run commit "your message" --push           # Commit and push
 * 
 * Conventional Commit Detection:
 *   - breaking/BREAKING/major prefix or ! suffix → Major bump
 *   - feat/feature/minor prefix → Minor bump
 *   - fix/patch/default → Patch bump
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION_FILE = path.join(__dirname, '..', 'version.txt');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getCurrentVersion() {
  if (!fs.existsSync(VERSION_FILE)) {
    return '1.0.0';
  }
  return fs.readFileSync(VERSION_FILE, 'utf-8').trim();
}

function parseVersion(version) {
  const parts = version.split('.').map(Number);
  return {
    major: parts[0] || 1,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

function formatVersion(major, minor, patch) {
  return `${major}.${minor}.${patch}`;
}

function detectBumpType(message) {
  const lowerMsg = message.toLowerCase();
  
  // Breaking change detection
  if (
    lowerMsg.startsWith('breaking:') ||
    lowerMsg.startsWith('major:') ||
    message.includes('BREAKING') ||
    message.endsWith('!')
  ) {
    return 'major';
  }
  
  // Feature detection
  if (
    lowerMsg.startsWith('feat:') ||
    lowerMsg.startsWith('feature:') ||
    lowerMsg.startsWith('minor:')
  ) {
    return 'minor';
  }
  
  // Default to patch
  return 'patch';
}

function bumpVersion(type) {
  const current = getCurrentVersion();
  const { major, minor, patch } = parseVersion(current);
  
  let newVersion;
  
  switch (type) {
    case 'major':
      newVersion = formatVersion(major + 1, 0, 0);
      break;
    case 'minor':
      newVersion = formatVersion(major, minor + 1, 0);
      break;
    case 'patch':
    default:
      newVersion = formatVersion(major, minor, patch + 1);
      break;
  }
  
  return { current, newVersion };
}

function runGitCommand(command, silent = false) {
  try {
    const result = execSync(command, { encoding: 'utf-8', stdio: silent ? 'pipe' : 'inherit' });
    return result;
  } catch (error) {
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let commitMessage = '';
  let explicitBumpType = null;
  let shouldPush = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--major') {
      explicitBumpType = 'major';
    } else if (arg === '--minor') {
      explicitBumpType = 'minor';
    } else if (arg === '--patch') {
      explicitBumpType = 'patch';
    } else if (arg === '--push' || arg === '-p') {
      shouldPush = true;
    } else if (!arg.startsWith('--')) {
      commitMessage = arg;
    }
  }
  
  if (!commitMessage) {
    log('', 'reset');
    log('❌ Error: Commit message is required', 'red');
    log('', 'reset');
    log('Usage:', 'cyan');
    log('  bun run commit "your commit message"           # Patch bump (default)', 'reset');
    log('  bun run commit "feat: your message" --minor    # Minor bump (new feature)', 'reset');
    log('  bun run commit "breaking: changes" --major     # Major bump', 'reset');
    log('  bun run commit "your message" --push           # Commit and push', 'reset');
    log('', 'reset');
    log('Conventional Commit Detection:', 'cyan');
    log('  breaking: / major: / message! → Major bump', 'reset');
    log('  feat: / feature:           → Minor bump', 'reset');
    log('  fix: / (default)           → Patch bump', 'reset');
    process.exit(1);
  }
  
  // Determine bump type
  const bumpType = explicitBumpType || detectBumpType(commitMessage);
  
  // Bump version
  const { current, newVersion } = bumpVersion(bumpType);
  
  // Write new version
  fs.writeFileSync(VERSION_FILE, newVersion);
  
  log('', 'reset');
  log(`📦 Version bump: ${current} → ${newVersion} (${bumpType})`, 'green');
  log('', 'reset');
  
  // Stage all changes including version.txt
  log('📁 Staging changes...', 'cyan');
  runGitCommand('git add -A');
  
  // Commit
  log('💾 Creating commit...', 'cyan');
  runGitCommand(`git commit -m "${commitMessage}"`);
  
  log('', 'reset');
  log(`✅ Commit created with version ${newVersion}`, 'green');
  log('', 'reset');
  
  // Push if requested
  if (shouldPush) {
    log('🚀 Pushing to remote...', 'cyan');
    
    // Check if we have a token in environment
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    
    if (githubToken) {
      // Set remote with token
      const repoUrl = 'https://github.com/travel-dev82/whats91.com.git';
      const authUrl = `https://${githubToken}@${repoUrl.replace('https://', '')}`;
      runGitCommand(`git remote set-url origin ${authUrl}`, true);
    }
    
    try {
      runGitCommand('git push origin master');
      runGitCommand('git push origin master:main');
      log('', 'reset');
      log('✅ Pushed to master and main branches', 'green');
    } catch (error) {
      log('', 'reset');
      log('⚠️  Push failed. You may need to push manually:', 'yellow');
      log('   git push origin master', 'reset');
      log('   git push origin master:main', 'reset');
    }
    
    // Reset remote URL (remove token)
    if (githubToken) {
      runGitCommand('git remote set-url origin https://github.com/travel-dev82/whats91.com.git', true);
    }
    
    log('', 'reset');
  } else {
    log('💡 Tip: Add --push to push to remote', 'yellow');
    log('', 'reset');
  }
}

main();
