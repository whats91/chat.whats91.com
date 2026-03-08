import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWithPassword } from '@/server/auth/auth-service';
import { getRequestClientIp } from '@/server/auth/request-security';
import {
  clearAuthSession,
  validateCsrfRequest,
  writeAuthSession,
} from '@/server/auth/session';
import { checkRateLimit } from '@/server/db/redis';

const passwordLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(191),
  password: z.string().min(1).max(255),
});

export async function POST(request: NextRequest) {
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

  const clientIp = getRequestClientIp(request);
  const rateLimit = await checkRateLimit(`auth:password:${clientIp}`, 25, 15 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: 'Too many login attempts. Please try again shortly.',
      },
      { status: 429 }
    );
  }

  let body: z.infer<typeof passwordLoginSchema>;
  try {
    body = passwordLoginSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Invalid login payload',
      },
      { status: 400 }
    );
  }

  const result = await authenticateWithPassword(body.identifier, body.password);
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

