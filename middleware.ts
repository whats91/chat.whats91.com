/**
 * Next.js 16 Proxy (Middleware)
 * 
 * Handles multi-tenant routing, request preprocessing, and security headers.
 * Renamed from "Middleware" to "Proxy" in Next.js 16.
 * 
 * @see https://nextjs.org/docs/app/building-your-application/routing/middleware
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(AUTH_SESSION_COOKIE_NAME);
  const isApiRoute = pathname.startsWith('/api/');
  const isPublicAsset =
    pathname.startsWith('/images/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/screenshots/') ||
    /\.[^/]+$/.test(pathname);
  const isProtectedPage =
    !isApiRoute &&
    !isPublicAsset &&
    pathname !== '/login' &&
    !pathname.startsWith('/_next') &&
    pathname !== '/favicon.ico';

  if (isProtectedPage && !hasSessionCookie) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }
  
  // Add security headers
  const response = NextResponse.next();
  
  // Security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Log in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Middleware] ${request.method} ${pathname}`);
  }
  
  return response;
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
