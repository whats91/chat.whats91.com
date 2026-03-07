import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Logger } from '@/lib/logger';

const log = new Logger('VersionAPI');

/**
 * GET /api/version
 * Returns current version info for the application
 * 
 * Version is read from:
 * 1. version.txt (preferred)
 * 2. package.json (fallback)
 */
export async function GET() {
  try {
    const cwd = process.cwd();
    let version = '1.0.0';
    let versionSource = 'default';
    
    // Try version.txt first (preferred)
    const versionTxtPath = path.join(cwd, 'version.txt');
    if (fs.existsSync(versionTxtPath)) {
      version = fs.readFileSync(versionTxtPath, 'utf-8').trim();
      versionSource = 'version.txt';
      log.debug('Version read from version.txt', { version });
    } else {
      // Fallback to package.json
      const packageJsonPath = path.join(cwd, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          version = packageJson.version || version;
          versionSource = 'package.json';
          log.debug('Version read from package.json', { version });
        } catch {
          log.warn('Failed to parse package.json');
        }
      }
    }
    
    // Get git info (only works if .git exists)
    let git = {
      commit: 'unknown',
      branch: 'unknown',
    };
    
    try {
      git.commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', timeout: 1000 }).trim();
      git.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', timeout: 1000 }).trim();
    } catch {
      // Git not available or not a git repo - this is expected in production standalone builds
      log.debug('Git info not available (expected in production standalone)');
    }
    
    log.info('Version request', { version, source: versionSource, commit: git.commit });
    
    return NextResponse.json({
      version,
      git,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    log.error('Failed to get version info', { error: error instanceof Error ? error.message : error });
    return NextResponse.json(
      { error: 'Failed to get version info' },
      { status: 500 }
    );
  }
}
