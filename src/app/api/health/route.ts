import { NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';

const log = new Logger('Health');

export async function GET() {
  log.debug('Health check requested');
  
  return NextResponse.json({ 
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    logLevel: process.env.LOG_LEVEL || 'debug',
  });
}
