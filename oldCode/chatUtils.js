/**
 * WhatsApp Chat System Utilities
 * Common functions and constants for the chat system
 */

/**
 * Format timestamp to display time
 */
export const formatMessageTime = (timestamp) => {
  const messageDate = new Date(timestamp);
  const now = new Date();
  const diffInDays = Math.floor((now - messageDate) / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) {
    // Today - show time only
    return messageDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } else if (diffInDays === 1) {
    // Yesterday
    return 'Yesterday';
  } else if (diffInDays < 7) {
    // This week - show day name
    return messageDate.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    // Older - show date
    return messageDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }
};

/**
 * Format timestamp to show relative time (e.g., "2 hours ago")
 */
export const formatRelativeTime = (timestamp) => {
  const messageDate = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now - messageDate) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes}m ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours}h ago`;
  } else if (diffInSeconds < 2592000) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days}d ago`;
  } else {
    return messageDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }
};

/**
 * Generate display name for contact
 */
export const getContactDisplayName = (contact) => {
  if (!contact) return null;
  
  if (contact.display_name) return contact.display_name;
  if (contact.contact_name) return contact.contact_name;
  
  const firstName = contact.first_name || contact.contact?.first_name || '';
  const lastName = contact.last_name || contact.contact?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  
  return fullName || contact.contact_phone || contact.phone || 'Unknown';
};

/**
 * Generate avatar initials from name
 */
export const getAvatarInitials = (name, fallback = '?') => {
  if (!name) return fallback;
  
  const words = name.trim().split(' ');
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  } else {
    return words[0][0].toUpperCase();
  }
};

/**
 * Generate avatar color based on name
 */
export const getAvatarColor = (name) => {
  const colors = [
    '#2A7B6E', '#3B82F6', '#8B5CF6', '#EF4444', '#F59E0B',
    '#10B981', '#6366F1', '#EC4899', '#F97316', '#84CC16'
  ];
  
  if (!name) return colors[0];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
};

/**
 * Message status icons and colors
 */
export const messageStatus = {
  pending: {
    icon: 'Clock',
    color: 'text-gray-400',
    label: 'Sending...'
  },
  sent: {
    icon: 'Check',
    color: 'text-gray-400',
    label: 'Sent'
  },
  delivered: {
    icon: 'CheckCheck',
    color: 'text-gray-400',
    label: 'Delivered'
  },
  read: {
    icon: 'CheckCheck',
    color: 'text-blue-500',
    label: 'Read'
  },
  failed: {
    icon: 'AlertCircle',
    color: 'text-red-500',
    label: 'Failed'
  }
};

/**
 * Get message preview text for conversation list
 */
export const getMessagePreview = (message, maxLength = 50) => {
  if (!message) return 'No messages yet';
  
  let preview = '';
  
  switch (message.message_type) {
    case 'text':
      preview = message.message_content || '';
      break;
    case 'image':
      preview = message.media_caption ? `📷 ${message.media_caption}` : '📷 Image';
      break;
    case 'video':
      preview = message.media_caption ? `🎥 ${message.media_caption}` : '🎥 Video';
      break;
    case 'audio':
      preview = '🎵 Audio';
      break;
    case 'document':
      preview = `📄 ${message.media_filename || 'Document'}`;
      break;
    case 'sticker':
      preview = '🏷️ Sticker';
      break;
    case 'location':
      preview = '📍 Location';
      break;
    case 'contacts':
    case 'contact':
      preview = '👤 Contact';
      break;
    case 'interactive':
      preview = '🔘 Interactive message';
      break;
    case 'button':
    case 'button_reply':
      preview = message.message_content || '🔘 Button reply';
      break;
    case 'list_reply':
      preview = message.message_content || '📋 List reply';
      break;
    case 'reaction':
      preview = message.message_content ? `😊 ${message.message_content}` : '😊 Reaction';
      break;
    case 'template':
      preview = message.message_content || '🧩 Template message';
      break;
    default:
      preview = `[${message.message_type.toUpperCase()}]`;
  }
  
  return preview.length > maxLength 
    ? preview.substring(0, maxLength) + '...' 
    : preview;
};

/**
 * Validate phone number format
 */
export const validatePhoneNumber = (phone) => {
  const numericRegex = /^\d+$/;
  const cleanPhone = phone?.toString().trim();
  
  if (!cleanPhone) return { valid: false, error: 'Phone number is required' };
  if (!numericRegex.test(cleanPhone)) return { valid: false, error: 'Phone number must contain only digits' };
  if (cleanPhone.length < 10) return { valid: false, error: 'Phone number must be at least 10 digits' };
  if (cleanPhone.length > 25) return { valid: false, error: 'Phone number cannot exceed 25 digits' };
  
  return { valid: true, error: null };
};

/**
 * Format phone number for display
 */
export const formatPhoneNumber = (phone) => {
  const cleanPhone = phone?.toString().replace(/\D/g, '');
  
  if (!cleanPhone) return '';
  
  // Format based on length (simple formatting)
  if (cleanPhone.length === 10) {
    return `(${cleanPhone.slice(0, 3)}) ${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`;
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return `+1 (${cleanPhone.slice(1, 4)}) ${cleanPhone.slice(4, 7)}-${cleanPhone.slice(7)}`;
  } else {
    // For international numbers, just add formatting
    return `+${cleanPhone}`;
  }
};

/**
 * Check if message is from today
 */
export const isMessageFromToday = (timestamp) => {
  const messageDate = new Date(timestamp);
  const today = new Date();
  
  return messageDate.toDateString() === today.toDateString();
};

/**
 * Group messages by date
 */
export const groupMessagesByDate = (messages) => {
  const groups = {};
  
  messages.forEach(message => {
    const date = new Date(message.timestamp).toDateString();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
  });
  
  return groups;
};

/**
 * Search conversations
 */
export const searchConversations = (conversations, query) => {
  if (!query.trim()) return conversations;
  
  const searchTerm = query.toLowerCase().trim();
  
  return conversations.filter(conversation => {
    const displayName = getContactDisplayName(conversation).toLowerCase();
    const phone = conversation.contact_phone?.toLowerCase() || '';
    const lastMessage = conversation.last_message_content?.toLowerCase() || '';
    
    return displayName.includes(searchTerm) || 
           phone.includes(searchTerm) || 
           lastMessage.includes(searchTerm);
  });
};

/**
 * Sort conversations by priority
 */
export const sortConversations = (conversations, sortBy = 'recent') => {
  const sorted = [...conversations];
  
  switch (sortBy) {
    case 'recent':
      return sorted.sort((a, b) => {
        // Pinned conversations first
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        
        // Then by last message time
        const timeA = new Date(a.last_message_at || a.created_at);
        const timeB = new Date(b.last_message_at || b.created_at);
        return timeB - timeA;
      });
    
    case 'unread':
      return sorted.sort((a, b) => {
        if (a.unread_count > 0 && b.unread_count === 0) return -1;
        if (a.unread_count === 0 && b.unread_count > 0) return 1;
        return b.unread_count - a.unread_count;
      });
    
    case 'name':
      return sorted.sort((a, b) => {
        const nameA = getContactDisplayName(a).toLowerCase();
        const nameB = getContactDisplayName(b).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    
    default:
      return sorted;
  }
};

/**
 * Constants
 */
export const CHAT_CONSTANTS = {
  MAX_MESSAGE_LENGTH: 4096,
  MAX_MEDIA_SIZE: 64 * 1024 * 1024, // 64MB
  SUPPORTED_MEDIA_TYPES: [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/avi', 'video/mov', 'video/wmv',
    'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ],
  WEBSOCKET_RECONNECT_DELAY: 3000,
  WEBSOCKET_MAX_RECONNECT_ATTEMPTS: 5,
  MESSAGE_BATCH_SIZE: 50,
  CONVERSATION_PAGE_SIZE: 20
};
