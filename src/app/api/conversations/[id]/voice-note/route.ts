import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import type { VoiceNoteRecordingMode } from '@/server/media/voice-note-audio';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
    const { id } = await params;
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const recordingMode = String(formData.get('recordingMode') || 'server-convert') as VoiceNoteRecordingMode;

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { success: false, message: 'No voice note file was uploaded' },
        { status: 400 }
      );
    }

    if (!['direct-ogg-opus', 'server-convert'].includes(recordingMode)) {
      return NextResponse.json(
        { success: false, message: 'Invalid recording mode' },
        { status: 400 }
      );
    }

    const result = await conversationController.sendVoiceNote({
      conversationId: Number.parseInt(id, 10),
      userId,
      teamMemberId: auth.user.teamMemberId,
      fileBuffer: Buffer.from(await fileEntry.arrayBuffer()),
      mimeType: fileEntry.type || 'application/octet-stream',
      originalFilename: fileEntry.name || `voice-note-${Date.now()}.bin`,
      fileSize: fileEntry.size,
      recordingMode,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send voice note',
      },
      { status: 500 }
    );
  }
}
