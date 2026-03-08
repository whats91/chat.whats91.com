import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWithOtp } from '@/server/auth/auth-service';
import { getRequestClientIp } from '@/server/auth/request-security';
import {
  clearAuthSession,
  validateCsrfRequest,
  writeAuthSession,
} from '@/server/auth/session';
import { checkRateLimit } from '@/server/db/redis';

const otpVerifySchema = z.object({
  phone: z.string().trim().min(6).max(32),
  otp: z.string().trim().regex(/^\d{6}$/),
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

  let body: z.infer<typeof otpVerifySchema>;
  try {
    body = otpVerifySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Invalid OTP verification payload',
      },
      { status: 400 }
    );
  }

  const clientIp = getRequestClientIp(request);
  const rateLimit = await checkRateLimit(`auth:otp:verify:${clientIp}`, 30, 15 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: 'Too many OTP verification attempts. Please try again later.',
      },
      { status: 429 }
    );
  }

  const result = await authenticateWithOtp(body.phone, body.otp);
  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        message: result.message,
        data: result.attemptsLeft == null ? null : { attemptsLeft: result.attemptsLeft },
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
