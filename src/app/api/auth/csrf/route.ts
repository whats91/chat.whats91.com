import { NextResponse } from 'next/server';
import { generateCsrfToken, setCsrfCookie } from '@/server/auth/session';

export async function GET() {
  const token = generateCsrfToken();
  const response = NextResponse.json({ success: true, token }, { status: 200 });
  setCsrfCookie(response, token);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
