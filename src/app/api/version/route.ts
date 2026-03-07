import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { Logger } from '@/lib/logger';

const log = new Logger('VersionAPI');

function findGitRoot(startDir: string): string | null {
  let currentDir = startDir;

  while (true) {
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

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
    
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      try {
        git.commit = runGit(['rev-parse', '--short', 'HEAD'], gitRoot);
        git.branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
      } catch {
        log.debug('Git info not available', { cwd: gitRoot });
      }
    } else {
      // This is expected in production standalone builds.
      log.debug('Git metadata skipped because no .git directory was found', { cwd });
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
