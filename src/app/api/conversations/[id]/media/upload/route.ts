import { NextRequest, NextResponse } from 'next/server';
import { uploadConversationMedia } from '@/server/media/conversation-media-service';
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
    const fileEntry = formData.get('files') || formData.get('file');

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { success: false, message: 'No file was uploaded' },
        { status: 400 }
      );
    }

    const result = await uploadConversationMedia({
      userId,
      conversationId: Number.parseInt(id, 10),
      fileBuffer: Buffer.from(await fileEntry.arrayBuffer()),
      mimeType: fileEntry.type,
      originalFilename: fileEntry.name,
      fileSize: fileEntry.size,
    });

    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        data: result.data,
      },
      { status: result.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to upload conversation media',
      },
      { status: 500 }
    );
  }
}
