import { NextRequest, NextResponse } from 'next/server';
import {
  clearAuthSession,
  getAuthenticatedUser,
  setCsrfCookie,
  validateCsrfRequest,
} from '@/server/auth/session';

export async function GET() {
  const user = await getAuthenticatedUser();
  const response = NextResponse.json(
    {
      authenticated: Boolean(user),
      user,
    },
    { status: 200 }
  );

  setCsrfCookie(response);
  response.headers.set('Cache-Control', 'no-store');

  return response;
}

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: 'Use the dedicated password or OTP login endpoints',
    },
    { status: 405 }
  );
}

export async function DELETE(request: NextRequest) {
  const csrfValidation = validateCsrfRequest(request);
  if (!csrfValidation.valid) {
    return NextResponse.json(
      {
        success: false,
        message: csrfValidation.message,
      },
      { status: 403 }
    );
  }

  const response = NextResponse.json(
    {
      success: true,
      message: 'Logged out successfully',
    },
    { status: 200 }
  );

  clearAuthSession(response);
  response.headers.set('Cache-Control', 'no-store');

  return response;
}
