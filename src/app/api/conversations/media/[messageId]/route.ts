import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getCurrentUserId } from '@/lib/config/current-user';
import { streamConversationMedia } from '@/server/media/conversation-media-service';

export const runtime = 'nodejs';

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body && typeof body === 'object' && 'transformToWebStream' in body) {
    const streamBody = body as { transformToWebStream: () => ReadableStream<Uint8Array> };
    return streamBody.transformToWebStream();
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }

  throw new Error('Unsupported media stream body');
}

function buildContentDisposition(filename: string | null, asDownload: boolean): string {
  const safeFilename = String(filename || 'media').replace(/["\r\n]/g, '_');
  return `${asDownload ? 'attachment' : 'inline'}; filename="${safeFilename}"`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const userId = getCurrentUserId();
    const { messageId } = await params;
    const asDownload = request.nextUrl.searchParams.get('download') === '1';

    const result = await streamConversationMedia({
      userId,
      messageId,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          needsDownload: result.needsDownload || false,
          messageId,
        },
        { status: result.status }
      );
    }

    return new Response(toWebStream(result.stream), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType || 'application/octet-stream',
        'Content-Disposition': buildContentDisposition(result.filename, asDownload),
        'Cache-Control': 'private, max-age=86400',
        ...(result.contentLength ? { 'Content-Length': String(result.contentLength) } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to stream media',
      },
      { status: 500 }
    );
  }
}
