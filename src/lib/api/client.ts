/**
 * API Client for Whats91 Chat
 * 
 * Handles all HTTP requests to the backend API
 */

import type { 
  ConversationListResponse, 
  ConversationDetailResponse,
  SendMessageRequest,
  SendMessageResponse
} from '@/lib/types/chat';

const API_BASE = '/api';

// Get current user ID from localStorage or session
function getUserId(): string {
  if (typeof window !== 'undefined') {
    // Try to get from localStorage
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        return user.id || '1';
      } catch {
        return '1';
      }
    }
  }
  return '1';
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
  conversationId: number,
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
  conversationId: number,
  messageData: SendMessageRequest
): Promise<SendMessageResponse> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(messageData),
  });
  
  return response.json();
}

/**
 * Mark conversation as read
 */
export async function markAsRead(conversationId: number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: getHeaders(),
  });
  
  return response.json();
}

/**
 * Toggle archive status
 */
export async function toggleArchive(conversationId: number): Promise<{ success: boolean; message: string; data?: { isArchived: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/archive`, {
    method: 'PATCH',
    headers: getHeaders(),
  });
  
  return response.json();
}

/**
 * Toggle pin status
 */
export async function togglePin(conversationId: number): Promise<{ success: boolean; message: string; data?: { isPinned: boolean } }> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/pin`, {
    method: 'PATCH',
    headers: getHeaders(),
  });
  
  return response.json();
}

/**
 * Delete conversation
 */
export async function deleteConversation(conversationId: number): Promise<{ success: boolean; message: string }> {
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
  conversationId: number,
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
    markAsRead,
    toggleArchive,
    togglePin,
    delete: deleteConversation,
    uploadMedia,
  },
};

export default api;
