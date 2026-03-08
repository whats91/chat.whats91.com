import 'server-only';

import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/server/auth/session';
import type { AuthenticatedUser } from '@/lib/types/auth';

type RouteAuthResult =
  | {
      user: AuthenticatedUser;
      response?: never;
    }
  | {
      user?: never;
      response: NextResponse;
    };

export async function requireAuthenticatedRouteUser(): Promise<RouteAuthResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      response: NextResponse.json(
        {
          success: false,
          message: 'Authentication required',
        },
        { status: 401 }
      ),
    };
  }

  return { user };
}

