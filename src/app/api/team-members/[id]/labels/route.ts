import { NextRequest, NextResponse } from 'next/server';
import { requireOwnerRouteUser } from '@/server/auth/route-auth';
import { updateTeamMemberLabelAssignments } from '@/server/db/team-members';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireOwnerRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      labelIds?: string[];
    };

    const teamMember = await updateTeamMemberLabelAssignments(
      auth.user.id,
      id,
      Array.isArray(body.labelIds) ? body.labelIds : []
    );

    return NextResponse.json({
      success: true,
      message: 'Label access updated',
      data: {
        teamMember,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update label access';
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
