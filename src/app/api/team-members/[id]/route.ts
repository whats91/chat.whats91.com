import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';
import { deleteTeamMember, updateTeamMember } from '@/server/db/team-members';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      email?: string | null;
      mobileNumber?: string | null;
    };

    const teamMember = await updateTeamMember(auth.user.id, id, {
      name: body.name || '',
      email: body.email,
      mobileNumber: body.mobileNumber,
    });

    return NextResponse.json({
      success: true,
      message: 'Team member updated',
      data: {
        teamMember,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update team member';
    const status = message === 'Team member not found' ? 404 : 400;

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const deleted = await deleteTeamMember(auth.user.id, id);

    if (!deleted) {
      return NextResponse.json(
        {
          success: false,
          message: 'Team member not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Team member deleted',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to delete team member',
      },
      { status: 400 }
    );
  }
}
