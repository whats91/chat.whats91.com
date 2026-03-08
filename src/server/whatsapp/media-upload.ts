import 'server-only';

import { Logger } from '@/lib/logger';

const log = new Logger('WhatsAppMediaUpload');
const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v24.0';

interface MetaMediaUploadApiResponse {
  id?: string;
  error?: {
    message?: string;
    code?: number;
    error_data?: {
      details?: string;
    };
  };
}

export interface UploadMediaToMetaParams {
  accessToken: string;
  phoneNumberId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  timeoutMs?: number;
}

export interface UploadMediaToMetaResult {
  success: boolean;
  mediaId?: string;
  message: string;
  errorCode?: number | string | null;
}

function parseApiResponse(rawResponse: string): MetaMediaUploadApiResponse | null {
  try {
    return JSON.parse(rawResponse) as MetaMediaUploadApiResponse;
  } catch {
    return null;
  }
}

export async function uploadMediaToMeta({
  accessToken,
  phoneNumberId,
  fileBuffer,
  fileName,
  mimeType,
  timeoutMs = 30000,
}: UploadMediaToMetaParams): Promise<UploadMediaToMetaResult> {
  if (!accessToken) {
    return {
      success: false,
      message: 'Missing WhatsApp access token',
      errorCode: 'MISSING_ACCESS_TOKEN',
    };
  }

  if (!phoneNumberId) {
    return {
      success: false,
      message: 'Missing WhatsApp phone number ID',
      errorCode: 'MISSING_PHONE_NUMBER_ID',
    };
  }

  const formData = new FormData();
  formData.set('messaging_product', 'whatsapp');
  formData.set('type', mimeType);
  formData.set('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);

  const uploadUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`;

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const rawBody = await response.text();
    const parsedBody = parseApiResponse(rawBody);

    if (!response.ok || !parsedBody?.id) {
      const errorMessage =
        parsedBody?.error?.error_data?.details ||
        parsedBody?.error?.message ||
        rawBody ||
        'Meta media upload failed';

      log.error('Media upload failed', {
        phoneNumberId,
        mimeType,
        status: response.status,
        errorMessage,
      });

      return {
        success: false,
        message: errorMessage,
        errorCode: parsedBody?.error?.code || response.status,
      };
    }

    return {
      success: true,
      mediaId: parsedBody.id,
      message: 'Media uploaded to Meta successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to upload media to Meta',
      errorCode: 'MEDIA_UPLOAD_FAILED',
    };
  }
}
