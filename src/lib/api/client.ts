/**
 * API Client for Whats91 Chat
 * 
 * Handles all HTTP requests to the backend API
 */

import type { 
  ConversationListResponse, 
  ConversationDetailResponse,
  ConversationTargetListResponse,
  SendMessageRequest,
  SendMessageResponse,
  StartConversationRequest,
  StartConversationResponse,
} from '@/lib/types/chat';
import { getCurrentUserId } from '@/lib/config/current-user';

const API_BASE = '/api';

function getUserId(): string {
  return getCurrentUserId();
}

// Default headers including user ID
function getHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-user-id': getUserId(),
  };
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

// API client object for convenience
export const api = {
  conversations: {
    list: fetchConversations,
    get: fetchConversation,
    sendMessage,
    fetchConversationTargets,
    startConversation,
    markAsRead,
    toggleMute,
    toggleArchive,
    togglePin,
    toggleMessagePinned,
    toggleMessageStarred,
    clear: clearConversation,
    delete: deleteConversation,
    uploadMedia,
  },
};

export default api;
