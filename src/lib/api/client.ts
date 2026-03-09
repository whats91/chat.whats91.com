/**
 * API Client for Whats91 Chat
 * 
 * Handles all HTTP requests to the backend API
 */

import type { 
  ConversationListResponse, 
  ConversationDetailResponse,
  PinnedMessageResponse,
  StarredMessagesResponse,
  ConversationMediaResponse,
  ConversationTargetListResponse,
  SendMessageRequest,
  SendMessageResponse,
  StartConversationRequest,
  StartConversationResponse,
} from '@/lib/types/chat';

const API_BASE = '/api';

// Default JSON headers for same-origin authenticated API calls.
function getHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
  };
}

function getFilenameFromDisposition(contentDisposition: string | null, fallbackFilename: string): string {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return fallbackFilename;
}

async function triggerFileDownloadFromResponse(response: Response, fallbackFilename: string): Promise<void> {
  if (!response.ok) {
    let errorMessage = 'Failed to download export';

    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.message === 'string' && errorPayload.message.trim()) {
        errorMessage = errorPayload.message;
      }
    } catch {
      // Ignore malformed error bodies and keep the fallback message.
    }

    throw new Error(errorMessage);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const filename = getFilenameFromDisposition(
    response.headers.get('content-disposition'),
    fallbackFilename
  );

  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(downloadUrl);
  }, 1000);
}

/**
 * Fetch conversations list with pagination
 */
export async function fetchConversations(params: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  archived?: boolean;
  unreadOnly?: boolean;
} = {}): Promise<ConversationListResponse> {
  const searchParams = new URLSearchParams();
  
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.search) searchParams.set('search', params.search);
  if (params.status) searchParams.set('status', params.status);
  if (params.archived) searchParams.set('archived', 'true');
  if (params.unreadOnly) searchParams.set('unreadOnly', 'true');
  
  const response = await fetch(`${API_BASE}/conversations?${searchParams.toString()}`, {
    headers: getHeaders(),
  });
  
  return response.json();
}

/**
 * Fetch a single conversation with messages
 */
export async function fetchConversation(
  conversationId: string | number,
  params: {
    page?: number;
    limit?: number;
    beforeMessageId?: string;
  } = {}
): Promise<ConversationDetailResponse> {
  const searchParams = new URLSearchParams();
  
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.beforeMessageId) searchParams.set('beforeMessageId', params.beforeMessageId);
  
  const response = await fetch(`${API_BASE}/conversations/${conversationId}?${searchParams.toString()}`, {
    headers: getHeaders(),
  });
  
  return response.json();
}

export async function fetchPinnedMessage(
  conversationId: string | number
): Promise<PinnedMessageResponse> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages/pinned`, {
    headers: getHeaders(),
  });

  return response.json();
}

export async function fetchStarredMessages(
  conversationId: string | number,
  params: { limit?: number } = {}
): Promise<StarredMessagesResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));

  const response = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages/starred?${searchParams.toString()}`,
    {
      headers: getHeaders(),
    }
  );

  return response.json();
}

export async function fetchConversationMedia(
  conversationId: string | number,
  params: { limit?: number } = {}
): Promise<ConversationMediaResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));

  const response = await fetch(
    `${API_BASE}/conversations/${conversationId}/media?${searchParams.toString()}`,
    {
      headers: getHeaders(),
    }
  );

  return response.json();
}

/**
 * Send a message
 */
export async function sendMessage(
  conversationId: string | number,
  messageData: SendMessageRequest
): Promise<SendMessageResponse> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(messageData),
  });
  
  return response.json();
}

export async function fetchConversationTargets(params: {
  search?: string;
  limit?: number;
} = {}): Promise<ConversationTargetListResponse> {
  const searchParams = new URLSearchParams();

  if (params.search) searchParams.set('search', params.search);
  if (params.limit) searchParams.set('limit', String(params.limit));

  const response = await fetch(`${API_BASE}/conversations/contacts?${searchParams.toString()}`, {
    headers: getHeaders(),
  });

  return response.json();
}

export async function startConversation(
  payload: StartConversationRequest
): Promise<StartConversationResponse> {
  const response = await fetch(`${API_BASE}/conversations/start`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  return response.json();
}

/**
 * Mark conversation as read
 */
export async function markAsRead(conversationId: string | number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: getHeaders(),
  });
  
  return response.json();
}

/**
 * Toggle mute status
 */
export async function toggleMute(conversationId: string | number): Promise<{ success: boolean; message: string; data?: { isMuted: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/mute`, {
    method: 'PATCH',
    headers: getHeaders(),
  });

  return response.json();
}

/**
 * Toggle blocked status
 */
export async function toggleBlock(conversationId: string | number): Promise<{ success: boolean; message: string; data?: { isBlocked: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/block`, {
    method: 'PATCH',
    headers: getHeaders(),
  });

  return response.json();
}

/**
 * Toggle archive status
 */
export async function toggleArchive(conversationId: string | number): Promise<{ success: boolean; message: string; data?: { isArchived: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/archive`, {
    method: 'PATCH',
    headers: getHeaders(),
  });
  
  return response.json();
}

/**
 * Toggle pin status
 */
export async function togglePin(conversationId: string | number): Promise<{ success: boolean; message: string; data?: { isPinned: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/pin`, {
    method: 'PATCH',
    headers: getHeaders(),
  });
  
  return response.json();
}

export async function toggleMessagePinned(
  conversationId: string | number,
  messageId: string | number
): Promise<{ success: boolean; message: string; data?: { isPinned: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages/${messageId}/pin`, {
    method: 'PATCH',
    headers: getHeaders(),
  });

  return response.json();
}

export async function toggleMessageStarred(
  conversationId: string | number,
  messageId: string | number
): Promise<{ success: boolean; message: string; data?: { isStarred: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages/${messageId}/star`, {
    method: 'PATCH',
    headers: getHeaders(),
  });

  return response.json();
}

/**
 * Clear conversation messages but keep the conversation
 */
export async function clearConversation(conversationId: string | number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/clear`, {
    method: 'POST',
    headers: getHeaders(),
  });

  return response.json();
}

/**
 * Delete conversation
 */
export async function deleteConversation(conversationId: string | number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  
  return response.json();
}

export async function exportConversationToExcel(conversationId: string | number): Promise<void> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/export`, {
    credentials: 'include',
  });
  await triggerFileDownloadFromResponse(response, `whats91-chat-${conversationId}.xls`);
}

export async function exportAllConversationsToExcel(): Promise<void> {
  const response = await fetch(`${API_BASE}/conversations/export`, {
    credentials: 'include',
  });
  await triggerFileDownloadFromResponse(response, 'whats91-all-chats.xls');
}

/**
 * Upload media for messaging
 */
export async function uploadMedia(
  conversationId: string | number,
  file: File
): Promise<{
  success: boolean;
  message: string;
  data?: Array<{
    uploadToken: string;
    proxyUrl: string;
    mimeType: string;
    fileSize: number;
    originalFilename: string;
  }>;
}> {
  const formData = new FormData();
  formData.append('files', file);
  
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/media/upload`, {
    method: 'POST',
    body: formData,
  });
  
  return response.json();
}

export async function sendVoiceNote(
  conversationId: string | number,
  file: File,
  params: {
    recordingMode: 'direct-ogg-opus' | 'server-convert';
  }
): Promise<SendMessageResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('recordingMode', params.recordingMode);

  const response = await fetch(`${API_BASE}/conversations/${conversationId}/voice-note`, {
    method: 'POST',
    body: formData,
  });

  return response.json();
}

// API client object for convenience
export const api = {
  conversations: {
    list: fetchConversations,
    get: fetchConversation,
    getPinnedMessage: fetchPinnedMessage,
    getStarredMessages: fetchStarredMessages,
    getConversationMedia: fetchConversationMedia,
    sendMessage,
    fetchConversationTargets,
    startConversation,
    markAsRead,
    toggleMute,
    toggleBlock,
    toggleArchive,
    togglePin,
    toggleMessagePinned,
    toggleMessageStarred,
    clear: clearConversation,
    delete: deleteConversation,
    exportConversationToExcel,
    exportAllConversationsToExcel,
    uploadMedia,
    sendVoiceNote,
  },
};

export default api;
