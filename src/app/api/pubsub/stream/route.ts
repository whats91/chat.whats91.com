import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';
import { getChannelName, subscribeToUser } from '@/server/pubsub/pubsub-service';
import { Logger } from '@/lib/logger';
import type { PubSubClientPayload, PubSubTransportEnvelope } from '@/lib/types/pubsub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = new Logger('PubSubStream');

function encodeSseMessage(payload: PubSubTransportEnvelope): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedRouteUser();
  if ('response' in auth) {
    log.warn('Rejected unauthenticated stream request');
    return auth.response;
  }

  const userId = auth.user.id;
  const expectedChannel = getChannelName(userId);
  const requestedChannel = request.nextUrl.searchParams.get('channel') || expectedChannel;

  if (requestedChannel !== expectedChannel) {
    log.warn('Rejected stream request for invalid channel', {
      userId,
      requestedChannel,
      expectedChannel,
    });
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid pub/sub channel for this user',
      },
      { status: 403 }
    );
  }

  let unsubscribe: (() => Promise<void> | void) | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      log.info('Opening pub/sub stream', {
        userId,
        channel: requestedChannel,
      });

      const send = (payload: PubSubTransportEnvelope) => {
        if (closed) {
          return;
        }

        log.debug('Sending SSE envelope', {
          userId,
          channel: requestedChannel,
          envelopeType: payload.type,
          payloadType:
            payload.type === 'message' ? payload.payload.type : null,
        });
        controller.enqueue(encodeSseMessage(payload));
      };

      const close = async () => {
        if (closed) {
          return;
        }

        closed = true;

        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }

        try {
          await unsubscribe?.();
        } finally {
          log.info('Closing pub/sub stream', {
            userId,
            channel: requestedChannel,
          });
          controller.close();
        }
      };

      request.signal.addEventListener(
        'abort',
        () => {
          void close();
        },
        { once: true }
      );

      send({
        type: 'connected',
        channel: requestedChannel,
        clientId: randomUUID(),
      });

      unsubscribe = await subscribeToUser(userId, (event) => {
        log.debug('Stream received pub/sub event', {
          userId,
          channel: requestedChannel,
          eventType: event.type,
        });
        send({
          type: 'message',
          id: randomUUID(),
          channel: requestedChannel,
          payload: event as PubSubClientPayload,
        });
      });

      send({
        type: 'subscribed',
        channel: requestedChannel,
        subscriberId: randomUUID(),
      });

      keepAliveTimer = setInterval(() => {
        if (closed) {
          return;
        }

        controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
      }, 25000);
    },
    async cancel() {
      closed = true;

      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }

      await unsubscribe?.();
      log.info('Pub/sub stream cancelled', {
        userId,
        channel: requestedChannel,
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
