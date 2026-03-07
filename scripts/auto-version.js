#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Auto Version Bump for Whats91 Chat
 * 
 * Usage:
 *   node scripts/auto-version.js           # Patch bump (default)
 *   node scripts/auto-version.js minor     # Minor bump
 *   node scripts/auto-version.js major     # Major bump
 * 
 * This script is designed to be used before git commits.
 * It reads the version from version.txt, bumps it, and writes it back.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION_FILE = path.join(__dirname, '..', 'version.txt');

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

function bumpVersion(type = 'patch') {
  const current = getCurrentVersion();
  const { major, minor, patch } = parseVersion(current);
  
  let newVersion;
  let bumpType = type;
  
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
      bumpType = 'patch';
      break;
  }
  
  return { current, newVersion, bumpType };
}

function main() {
  const args = process.argv.slice(2);
  const bumpType = args[0] || 'patch';
  
  if (!['major', 'minor', 'patch'].includes(bumpType)) {
    console.error('Usage: node scripts/auto-version.js [patch|minor|major]');
    process.exit(1);
  }
  
  const { current, newVersion } = bumpVersion(bumpType);
  
  // Write new version
  fs.writeFileSync(VERSION_FILE, newVersion);
  
  console.log('');
  console.log(`📦 Version bump: ${current} → ${newVersion} (${bumpType})`);
  console.log('');
  
  // Stage the version file
  try {
    execSync('git add version.txt', { stdio: 'inherit' });
  } catch (e) {
    // Ignore if not in a git repo
  }
}

main();
