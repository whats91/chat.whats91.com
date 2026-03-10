import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWithAuthToken } from '@/server/auth/auth-service';
import { getRequestClientIp } from '@/server/auth/request-security';
import {
  clearAuthSession,
  writeAuthSession,
} from '@/server/auth/session';
import { checkRateLimit } from '@/server/db/redis';

const authTokenLoginSchema = z.object({
  authToken: z.string().trim().min(8).max(2048),
});

export async function POST(request: NextRequest) {
  const clientIp = getRequestClientIp(request);
  const rateLimit = await checkRateLimit(`auth:token:${clientIp}`, 60, 15 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: 'Too many automatic login attempts. Please try again shortly.',
      },
      { status: 429 }
    );
  }

  let body: z.infer<typeof authTokenLoginSchema>;
  try {
    body = authTokenLoginSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Invalid automatic login payload',
      },
      { status: 400 }
    );
  }

  const result = await authenticateWithAuthToken(body.authToken);
  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        message: result.message,
      },
      { status: 401 }
    );
  }

  const response = NextResponse.json(
    {
      success: true,
      message: 'Logged in successfully',
      user: result.user,
    },
    { status: 200 }
  );

  clearAuthSession(response);
  writeAuthSession(response, result.user);
  response.headers.set('Cache-Control', 'no-store');

  return response;
}
