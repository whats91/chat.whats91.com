#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Version Bump Script
 * 
 * Usage:
 *   node scripts/bump-version.js           # Bumps patch version (1.0.0 -> 1.0.1)
 *   node scripts/bump-version.js minor     # Bumps minor version (1.0.0 -> 1.1.0)
 *   node scripts/bump-version.js major     # Bumps major version (1.0.0 -> 2.0.0)
 *   node scripts/bump-version.js set 1.2.3 # Sets specific version
 */

const fs = require('fs');
const path = require('path');

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
  
  return newVersion;
}

function setVersion(version) {
  const { major, minor, patch } = parseVersion(version);
  return formatVersion(major, minor, patch);
}

function main() {
  const args = process.argv.slice(2);
  const currentVersion = getCurrentVersion();
  let newVersion;

  if (args.length === 0) {
    // Default: bump patch
    newVersion = bumpVersion('patch');
  } else if (args[0] === 'set' && args[1]) {
    // Set specific version
    newVersion = setVersion(args[1]);
  } else if (['major', 'minor', 'patch'].includes(args[0])) {
    // Bump specific type
    newVersion = bumpVersion(args[0]);
  } else {
    console.error('Usage:');
    console.error('  node scripts/bump-version.js           # Bumps patch version');
    console.error('  node scripts/bump-version.js minor     # Bumps minor version');
    console.error('  node scripts/bump-version.js major     # Bumps major version');
    console.error('  node scripts/bump-version.js set 1.2.3 # Sets specific version');
    process.exit(1);
  }

  fs.writeFileSync(VERSION_FILE, newVersion);
  console.log(`Version bumped: ${currentVersion} → ${newVersion}`);
}

main();
