import { NextRequest, NextResponse } from 'next/server';
import { requireOwnerRouteUser } from '@/server/auth/route-auth';
import {
  assignConversationToTeamMember,
  getConversationAssignedTeamMember,
} from '@/server/db/conversation-team-assignments';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireOwnerRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const assignedTeamMember = await getConversationAssignedTeamMember(auth.user.id, id);

    return NextResponse.json({
      success: true,
      data: {
        assignedTeamMember,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load conversation assignment';
    const status = message === 'Conversation not found' ? 404 : 400;

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireOwnerRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      teamMemberId?: string | null;
    };

    const assignedTeamMember = await assignConversationToTeamMember(
      auth.user.id,
      id,
      body.teamMemberId ? String(body.teamMemberId) : null
    );

    return NextResponse.json({
      success: true,
      message: assignedTeamMember ? 'Conversation assigned' : 'Conversation assignment cleared',
      data: {
        assignedTeamMember,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update conversation assignment';
    const status =
      message === 'Conversation not found' || message === 'Team member not found' ? 404 : 400;

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}
