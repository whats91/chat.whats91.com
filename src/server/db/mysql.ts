/**
 * Main Database Connection Module
 * 
 * This module provides MySQL connection for the main application database.
 * Uses Prisma Client for type-safe database operations.
 * 
 * Database: whats91_chat (or configured DB_NAME)
 * Tables: users, contacts, cloud_api_setup, cloud_api_reports
 */

import 'server-only';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@/lib/logger';

const log = new Logger('MainDB');

// Type definitions for MySQL connection
export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

const globalForMainDb = globalThis as typeof globalThis & {
  __whats91MainDb?: PrismaClient;
};

function createMainDbClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.ENABLE_DB_QUERY_LOGGING === 'true'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });
}

/**
 * Get the Prisma client instance for the main database
 */
export function getMainDb(): PrismaClient {
  if (!globalForMainDb.__whats91MainDb) {
    globalForMainDb.__whats91MainDb = createMainDbClient();
    log.info('Prisma client initialized');
  }

  return globalForMainDb.__whats91MainDb;
}

/**
 * Test the database connection
 */
export async function testMainDbConnection(): Promise<boolean> {
  try {
    const prisma = getMainDb();
    await prisma.$queryRaw`SELECT 1`;
    log.info('Connection test successful');
    return true;
  } catch (error) {
    log.error('Connection test failed', { error: error instanceof Error ? error.message : error });
    return false;
  }
}

/**
 * Close the database connection
 */
export async function closeMainDb(): Promise<void> {
  if (globalForMainDb.__whats91MainDb) {
    await globalForMainDb.__whats91MainDb.$disconnect();
    delete globalForMainDb.__whats91MainDb;
    log.info('Connection closed');
  }
}

// Default export for convenience
export default getMainDb;

// Export the db instance for backward compatibility
export const db = getMainDb();
