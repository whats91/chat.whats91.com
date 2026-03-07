# Whats91 Chat - TypeScript Implementation Guide

Last updated: 2025-01-16

## Overview

This document describes the TypeScript implementation of the Whats91 Chat platform, migrated from the original Node.js/JSX codebase. The implementation follows Next.js 16 App Router conventions with TypeScript 5.

## Architecture

### Database Structure

The platform uses a **dual-database architecture**:

1. **Main Database** (`whats91_chat`)
   - Users
   - Contacts
   - CloudApiSetup (WhatsApp configuration)
   - CloudApiReports (message delivery tracking)

2. **Conversations Database** (`whats91_chat_conversations`)
   - Conversations
   - ConversationMessages
   - MediaStorage
   - MessageReactions

### Technology Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript 5
- **ORM**: Prisma (MySQL)
- **State Management**: Zustand
- **Real-time**: Redis Pub/Sub with in-memory fallback
- **UI Components**: shadcn/ui with Tailwind CSS 4

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── conversations/
│   │   │   ├── route.ts                    # GET conversation list
│   │   │   └── [id]/
│   │   │       ├── route.ts                # GET/DELETE conversation
│   │   │       ├── messages/route.ts       # POST send message
│   │   │       ├── read/route.ts           # POST mark as read
│   │   │       ├── archive/route.ts        # PATCH toggle archive
│   │   │       └── pin/route.ts            # PATCH toggle pin
│   │   └── whatsapp/
│   │       ├── webhooks/route.ts           # Webhook handler
│   │       └── messages/route.ts           # Message send (legacy)
│   ├── chats/page.tsx                      # Main chat page
│   └── settings/page.tsx                   # Settings page
├── components/
│   ├── chat/
│   │   ├── ChatList.tsx                    # Conversation sidebar
│   │   ├── ConversationView.tsx            # Message thread view
│   │   ├── RightInfoPanel.tsx              # Contact details panel
│   │   └── NewChatModal.tsx                # New conversation modal
│   └── shell/
│       ├── AppShell.tsx                    # Main layout shell
│       ├── DesktopShell.tsx                # Desktop layout
│       └── MobileShell.tsx                 # Mobile layout
├── lib/
│   ├── types/chat.ts                       # TypeScript type definitions
│   ├── db.ts                               # Prisma client export
│   └── mock/data.ts                        # Mock data for development
├── server/
│   ├── db/
│   │   ├── mysql.ts                        # Main database connection
│   │   ├── conversations-db.ts             # Conversations database
│   │   └── redis.ts                        # Redis connection (with fallback)
│   ├── controllers/
│   │   └── conversation-controller.ts      # Main business logic
│   ├── whatsapp/
│   │   ├── message-sender.ts               # WhatsApp Cloud API sender
│   │   ├── verify.ts                       # Webhook signature verification
│   │   └── types.ts                        # WhatsApp types
│   └── pubsub/
│       └── pubsub-service.ts               # Real-time messaging
└── stores/
    └── chatStore.ts                        # Zustand state store
```

## Environment Configuration

Create a `.env` file based on `.env.example`:

```env
# Main Database
DATABASE_URL="mysql://user:password@localhost:3306/whats91_chat"

# Conversations Database
CONVERSATIONS_DATABASE_URL="mysql://user:password@localhost:3306/whats91_chat_conversations"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# WhatsApp Cloud API
META_GRAPH_API_VERSION=v24.0
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token
WHATSAPP_APP_SECRET=your_app_secret

# Wasabi Storage
WASABI_ENDPOINT=https://s3.wasabisys.com
WASABI_REGION=us-east-1
WASABI_ACCESS_KEY=your_access_key
WASABI_SECRET_KEY=your_secret_key
WASABI_BUCKET=your-bucket-name
```

## API Endpoints

### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conversations` | List conversations with pagination |
| GET | `/api/conversations/:id` | Get conversation with messages |
| POST | `/api/conversations/:id/messages` | Send a message |
| POST | `/api/conversations/:id/read` | Mark as read |
| PATCH | `/api/conversations/:id/archive` | Toggle archive |
| PATCH | `/api/conversations/:id/pin` | Toggle pin |
| DELETE | `/api/conversations/:id` | Delete conversation |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/whatsapp/webhooks` | Webhook verification |
| POST | `/api/whatsapp/webhooks` | Receive webhook events |

## Message Flow

### Outbound Flow (Sending)

1. User sends message from UI
2. `POST /api/conversations/:id/messages` receives request
3. `conversationController.sendMessage()` processes:
   - Validates conversation exists
   - Gets CloudApiSetup for WhatsApp credentials
   - Builds message payload
   - Calls `sendMessageToMeta()` to send to WhatsApp
   - Stores message in database
   - Updates conversation metadata
   - Publishes real-time event via pub/sub

### Inbound Flow (Receiving)

1. WhatsApp sends webhook to `POST /api/whatsapp/webhooks`
2. Webhook handler:
   - Finds CloudApiSetup by phone number ID
   - Parses message content based on type
   - Calls `processIncomingMessage()`:
     - Finds or creates conversation
     - Stores message in database
     - Updates conversation metadata
     - Publishes real-time event via pub/sub

### Status Updates

1. WhatsApp sends status webhook
2. `updateMessageStatus()` updates message in database
3. Publishes status update event via pub/sub
4. Connected clients receive real-time update

## Real-time Events

### Event Types

```typescript
type PubSubEventType = 'new_message' | 'status_update' | 'conversation_update';
```

### Event Structure

```typescript
interface PubSubEvent {
  type: PubSubEventType;
  timestamp: string;
  data: Record<string, unknown>;
}
```

### Channel Naming

```
conversations-{userId}
```

## Database Schema

### Conversations Table

```sql
CREATE TABLE conversations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  contact_phone VARCHAR(25) NOT NULL,
  contact_name VARCHAR(255),
  whatsapp_phone_number_id VARCHAR(50) NOT NULL,
  last_message_id VARCHAR(100),
  last_message_content TEXT,
  last_message_type VARCHAR(50),
  last_message_at DATETIME,
  last_message_direction ENUM('inbound', 'outbound'),
  unread_count INT DEFAULT 0,
  total_messages INT DEFAULT 0,
  is_archived BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_muted BOOLEAN DEFAULT FALSE,
  status ENUM('active', 'closed', 'blocked') DEFAULT 'active',
  meta_data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (user_id, contact_phone),
  INDEX (user_id, last_message_at),
  INDEX (whatsapp_phone_number_id)
);
```

### Conversation Messages Table

```sql
CREATE TABLE conversation_messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  whatsapp_message_id VARCHAR(100) UNIQUE NOT NULL,
  from_phone VARCHAR(25) NOT NULL,
  to_phone VARCHAR(25) NOT NULL,
  direction ENUM('inbound', 'outbound') NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  message_content TEXT,
  media_url VARCHAR(500),
  media_mime_type VARCHAR(100),
  media_filename VARCHAR(255),
  media_caption TEXT,
  status ENUM('pending', 'sent', 'delivered', 'read', 'failed') DEFAULT 'pending',
  is_read BOOLEAN DEFAULT FALSE,
  read_at DATETIME,
  replied_to_message_id VARCHAR(100),
  interactive_data JSON,
  location_data JSON,
  contact_data JSON,
  timestamp DATETIME NOT NULL,
  error_message TEXT,
  webhook_data JSON,
  outgoing_payload JSON,
  incoming_payload JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (conversation_id, timestamp),
  INDEX (whatsapp_message_id),
  INDEX (direction, status),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

## Error Handling

### WhatsApp Error Codes

| Code | Status | Retryable | Description |
|------|--------|-----------|-------------|
| 131049 | ecosystem_limited | Yes (12h) | Ecosystem engagement limit |
| 131048 | spam_rate_limited | Yes (30m) | Spam rate limit |
| 131056 | pair_rate_limited | Yes (5m) | Pair rate limit |
| 131026 | notonwa | No | Phone not on WhatsApp |
| 131021 | blocked | No | User opted out |
| 131031 | blocked | No | User blocked business |
| 190 | token_expired | No | Access token expired |

## Migration from Old Code

### Key Changes

1. **JSX → TypeScript**: All components converted to TypeScript with proper types
2. **Sequelize → Prisma**: ORM changed from Sequelize to Prisma
3. **Express Routes → Next.js Route Handlers**: API routes use Next.js App Router
4. **Socket.io → Redis Pub/Sub**: Real-time via Redis with in-memory fallback

### Files to Remove (Legacy)

- `oldCode/frontend/chat/components/ChatWebSocket.jsx` - Replaced by pub/sub service
- `oldCode/frontend/chat/components/MessageComposer.jsx` - Replaced by refactored version
- `oldCode/frontend/chat/components/refactored/useChatStore.js` - Replaced by new Zustand store

## Testing

1. Set up MySQL databases
2. Run Prisma migrations:
   ```bash
   bun run db:push
   ```
3. Configure `.env` with your credentials
4. Start the development server:
   ```bash
   bun run dev
   ```

## Deployment

1. Build the application:
   ```bash
   bun run build
   ```
2. Set production environment variables
3. Run database migrations
4. Start the server

## References

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Original Implementation Guide](./oldCode/CHAT_MODULE_IMPLEMENTATION_GUIDE.md)
