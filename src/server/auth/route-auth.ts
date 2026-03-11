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

export async function requireOwnerRouteUser(): Promise<RouteAuthResult> {
  const auth = await requireAuthenticatedRouteUser();
  if ('response' in auth) {
    return auth;
  }

  if (auth.user.principalType !== 'owner') {
    return {
      response: NextResponse.json(
        {
          success: false,
          message: 'Only workspace owners can access this resource',
        },
        { status: 403 }
      ),
    };
  }

  return auth;
}
