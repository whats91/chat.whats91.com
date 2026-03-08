// Mock data for development - simulates WhatsApp-like conversations

import type { User, Message, Conversation, WhatsAppTemplate, Tenant } from '@/lib/types/chat';

// Mock users
export const mockUsers: User[] = [
  {
    id: 'user-1',
    name: 'John Smith',
    phone: '+1 555-0101',
    email: 'john.smith@example.com',
    status: 'online',
    avatar: undefined,
  },
  {
    id: 'user-2',
    name: 'Sarah Johnson',
    phone: '+1 555-0102',
    email: 'sarah.j@example.com',
    status: 'online',
    avatar: undefined,
  },
  {
    id: 'user-3',
    name: 'Mike Williams',
    phone: '+1 555-0103',
    status: 'offline',
    lastSeen: new Date(Date.now() - 3600000),
    avatar: undefined,
  },
  {
    id: 'user-4',
    name: 'Emily Davis',
    phone: '+1 555-0104',
    status: 'typing',
    avatar: undefined,
  },
  {
    id: 'user-5',
    name: 'Tech Support',
    phone: '+1 555-0200',
    email: 'support@techcorp.com',
    status: 'online',
    avatar: undefined,
  },
  {
    id: 'user-6',
    name: 'Sales Team',
    phone: '+1 555-0201',
    status: 'offline',
    lastSeen: new Date(Date.now() - 7200000),
    avatar: undefined,
  },
  {
    id: 'user-7',
    name: 'Marketing Desk',
    phone: '+1 555-0300',
    status: 'offline',
    avatar: undefined,
  },
  {
    id: 'user-8',
    name: 'David Brown',
    phone: '+1 555-0105',
    status: 'online',
    avatar: undefined,
  },
  {
    id: 'user-9',
    name: 'Lisa Anderson',
    phone: '+1 555-0106',
    status: 'offline',
    lastSeen: new Date(Date.now() - 86400000),
    avatar: undefined,
  },
  {
    id: 'user-10',
    name: 'Robert Taylor',
    phone: '+1 555-0107',
    status: 'online',
    avatar: undefined,
  },
];

// Current user (the one using the chat)
export const currentUser: User = {
  id: 'current-user',
  name: 'You',
  phone: '+1 555-0000',
  status: 'online',
};

// Generate mock messages for a conversation
function generateMessages(conversationId: string, participantId: string): Message[] {
  const now = Date.now();
  const messages: Message[] = [];
  
  const messageTemplates = [
    { content: "Hey! How are you doing?", isInbound: true },
    { content: "I'm doing great, thanks for asking! How about you?", isInbound: false },
    { content: "Pretty good! Just finished a big project at work.", isInbound: true },
    { content: "That's awesome! Congratulations! 🎉", isInbound: false },
    { content: "Thanks! It was a lot of work but worth it.", isInbound: true },
    { content: "What kind of project was it?", isInbound: false },
    { content: "We built a new chat system for our customers. It integrates with WhatsApp!", isInbound: true },
    { content: "That sounds really interesting! Are you using the WhatsApp Cloud API?", isInbound: false },
    { content: "Yes! It's been great so far. The webhook integration is really smooth.", isInbound: true },
    { content: "Nice! I've heard good things about it. How's the response time?", isInbound: false },
    { content: "Pretty fast actually. Usually under 2 seconds for message delivery.", isInbound: true },
    { content: "That's impressive. We should chat more about this sometime.", isInbound: false },
    { content: "Definitely! Let me know if you want to see a demo.", isInbound: true },
    { content: "I'd love that! Are you free this week?", isInbound: false },
    { content: "How about Thursday at 3pm?", isInbound: true },
    { content: "Perfect, I'll put it in my calendar.", isInbound: false },
  ];
  
  messageTemplates.forEach((template, index) => {
    const timestamp = new Date(now - (messageTemplates.length - index) * 60000 * 5);
    messages.push({
      id: `msg-${conversationId}-${index}`,
      conversationId,
      senderId: template.isInbound ? participantId : 'current-user',
      content: template.content,
      type: 'text',
      status: template.isInbound ? 'read' : 'read',
      timestamp,
    });
  });
  
  return messages;
}

// Generate mock conversations
export function generateMockConversations(): Conversation[] {
  return mockUsers.map((user, index) => ({
    id: `conv-${user.id}`,
    participant: user,
    lastMessage: {
      id: `last-msg-${user.id}`,
      conversationId: `conv-${user.id}`,
      senderId: index % 2 === 0 ? user.id : 'current-user',
      content: getLastMessageContent(index),
      type: 'text' as const,
      status: 'read' as const,
      timestamp: new Date(Date.now() - index * 3600000),
    },
    unreadCount: index % 3 === 0 ? Math.floor(Math.random() * 5) : 0,
    isPinned: index < 2,
    isArchived: index === 5,
    isMuted: index === 6,
    isBlocked: false,
    labels: index === 4 ? ['VIP', 'Support'] : index === 5 ? ['Lead'] : [],
    createdAt: new Date(Date.now() - index * 86400000 * 2),
    updatedAt: new Date(Date.now() - index * 3600000),
    typing: user.status === 'typing' ? { isTyping: true, userId: user.id } : undefined,
  }));
}

function getLastMessageContent(index: number): string {
  const contents = [
    "That sounds great! Let's do it. 👍",
    "Can you send me the details?",
    "Thanks for the update!",
    "I'll check and get back to you.",
    "Perfect, see you then!",
    "Got it, thanks!",
    "Sure thing!",
    "Let me think about it...",
    "That's interesting!",
    "No problem at all.",
  ];
  return contents[index % contents.length];
}

// Store messages by conversation
const messagesStore: Map<string, Message[]> = new Map();

export function getMockMessages(conversationId: string): Message[] {
  if (!messagesStore.has(conversationId)) {
    const participantId = conversationId.replace('conv-user-', '').replace('conv-', '');
    messagesStore.set(conversationId, generateMessages(conversationId, participantId));
  }
  return messagesStore.get(conversationId) || [];
}

export function addMockMessage(conversationId: string, content: string, senderId: string = 'current-user'): Message {
  const messages = getMockMessages(conversationId);
  const newMessage: Message = {
    id: `msg-${Date.now()}`,
    conversationId,
    senderId,
    content,
    type: 'text',
    status: 'sending',
    timestamp: new Date(),
  };
  messages.push(newMessage);
  return newMessage;
}

export function updateMessageStatus(messageId: string, status: Message['status']): void {
  for (const [, messages] of messagesStore) {
    const message = messages.find(m => m.id === messageId);
    if (message) {
      message.status = status;
      break;
    }
  }
}

// Mock WhatsApp templates
export const mockTemplates: WhatsAppTemplate[] = [
  {
    id: 'tpl-1',
    name: 'welcome_message',
    language: 'en',
    category: 'utility',
    status: 'approved',
    components: [
      { type: 'body', text: 'Hi {{1}}, welcome to our service! We\'re here to help.' },
      { type: 'button', text: 'Get Started' },
    ],
  },
  {
    id: 'tpl-2',
    name: 'order_confirmation',
    language: 'en',
    category: 'utility',
    status: 'approved',
    components: [
      { type: 'header', text: 'Order Confirmed ✅' },
      { type: 'body', text: 'Your order #{{1}} has been confirmed. Expected delivery: {{2}}.' },
      { type: 'footer', text: 'Thank you for your purchase!' },
    ],
  },
  {
    id: 'tpl-3',
    name: 'appointment_reminder',
    language: 'en',
    category: 'utility',
    status: 'approved',
    components: [
      { type: 'body', text: 'Reminder: You have an appointment on {{1}} at {{2}}.' },
    ],
  },
  {
    id: 'tpl-4',
    name: 'promotional_offer',
    language: 'en',
    category: 'marketing',
    status: 'approved',
    components: [
      { type: 'header', text: 'Special Offer! 🎉' },
      { type: 'body', text: 'Hi {{1}}! Get {{2}}% off on your next purchase. Use code: {{3}}' },
    ],
  },
  {
    id: 'tpl-5',
    name: 'verification_code',
    language: 'en',
    category: 'authentication',
    status: 'pending',
    components: [
      { type: 'body', text: 'Your verification code is {{1}}. Valid for {{2}} minutes.' },
    ],
  },
];

// Mock tenant for multi-tenant support
export const mockTenant: Tenant = {
  id: 'tenant-1',
  name: 'Acme Corp',
  subdomain: 'acme',
  wabaId: 'waba-123456789',
  phoneNumberId: 'phone-987654321',
  tokenStatus: 'valid',
  tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  webhookStatus: 'verified',
  qualityRating: 'high',
  createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
};

// Mock labels/tags
export const mockLabels = [
  { id: 'label-1', name: 'VIP', color: '#FF6B6B' },
  { id: 'label-2', name: 'Support', color: '#4ECDC4' },
  { id: 'label-3', name: 'Lead', color: '#FFE66D' },
  { id: 'label-4', name: 'Customer', color: '#95E1D3' },
  { id: 'label-5', name: 'Partner', color: '#DDA0DD' },
];
