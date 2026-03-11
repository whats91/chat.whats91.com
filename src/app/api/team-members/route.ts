import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';
import { createTeamMember, listTeamMembersByUser } from '@/server/db/team-members';

export async function GET() {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const teamMembers = await listTeamMembersByUser(auth.user.id);

    return NextResponse.json({
      success: true,
      data: {
        teamMembers,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to load team members',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const body = (await request.json()) as {
      name?: string;
      email?: string | null;
      mobileNumber?: string | null;
    };

    const teamMember = await createTeamMember(auth.user.id, {
      name: body.name || '',
      email: body.email,
      mobileNumber: body.mobileNumber,
    });

    return NextResponse.json({
      success: true,
      message: 'Team member added',
      data: {
        teamMember,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to add team member',
      },
      { status: 400 }
    );
  }
}
