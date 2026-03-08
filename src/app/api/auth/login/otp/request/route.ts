import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestLoginOtp } from '@/server/auth/auth-service';
import { getRequestClientIp } from '@/server/auth/request-security';
import { validateCsrfRequest } from '@/server/auth/session';
import { checkRateLimit } from '@/server/db/redis';

const otpRequestSchema = z.object({
  phone: z.string().trim().min(6).max(32),
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

  let body: z.infer<typeof otpRequestSchema>;
  try {
    body = otpRequestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Invalid OTP request payload',
      },
      { status: 400 }
    );
  }

  const clientIp = getRequestClientIp(request);
  const ipLimit = await checkRateLimit(`auth:otp:request:ip:${clientIp}`, 15, 15 * 60);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: 'Too many OTP requests. Please wait before trying again.',
      },
      { status: 429 }
    );
  }

  const phoneDigits = body.phone.replace(/\D/g, '');
  const phoneLimit = await checkRateLimit(`auth:otp:request:phone:${phoneDigits}`, 5, 15 * 60);
  if (!phoneLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: 'Too many OTP requests for this phone number. Please wait before trying again.',
      },
      { status: 429 }
    );
  }

  const result = await requestLoginOtp(body.phone);
  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        message: result.message,
      },
      { status: 400 }
    );
  }

  const response = NextResponse.json(
    {
      success: true,
      message: result.message,
      data: {
        maskedPhone: result.maskedPhone,
      },
    },
    { status: 200 }
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

