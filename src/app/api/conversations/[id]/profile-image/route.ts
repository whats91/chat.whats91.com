import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

export const runtime = 'nodejs';

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body && typeof body === 'object' && 'transformToWebStream' in body) {
    const streamBody = body as { transformToWebStream: () => ReadableStream<Uint8Array> };
    return streamBody.transformToWebStream();
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }

  throw new Error('Unsupported profile image stream body');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await params;
    const result = await conversationController.streamConversationProfileImage({
      conversationId: Number.parseInt(id, 10),
      userId: auth.user.id,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.status }
      );
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'private, max-age=3600',
    };

    if (result.mimeType) {
      headers['Content-Type'] = result.mimeType;
    }

    if (result.contentLength) {
      headers['Content-Length'] = String(result.contentLength);
    }

    return new Response(toWebStream(result.stream), {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to stream conversation profile image',
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const { id } = await params;
    const formData = await request.formData();
    const fileEntry = formData.get('file');

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { success: false, message: 'No profile image was uploaded' },
        { status: 400 }
      );
    }

    const result = await conversationController.uploadConversationProfileImage({
      conversationId: Number.parseInt(id, 10),
      userId: auth.user.id,
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
        message: error instanceof Error ? error.message : 'Failed to upload conversation profile image',
      },
      { status: 500 }
    );
  }
}
