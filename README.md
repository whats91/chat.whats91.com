# Whats91 Chat

Whats91 Chat is a multi-tenant WhatsApp Cloud API inbox built with Next.js App Router and TypeScript. It combines a browser chat UI, server-side WhatsApp integrations, dual-database access, Wasabi-backed media storage, real-time Pub/Sub updates, and a cookie-based auth system.

## Architecture At A Glance

- `Next.js App Router` powers both the frontend and the internal API routes.
- `TypeScript` is used across the app, API routes, store, and server helpers.
- `Zustand` manages the client chat state.
- `Prisma + raw SQL` connect to two MySQL databases:
  - main database: users, cloud API setup, templates, labels
  - conversations database: conversations, messages, status history, media metadata
- `Wasabi (S3-compatible)` stores uploaded and cached media.
- `WhatsApp Cloud API` handles message send, media upload, templates, webhook delivery, and message statuses.
- `Pub/Sub` drives live message and status updates into the UI.
- `Service worker + Notification API` handle PWA behavior and browser notifications.

## Top-Level Structure

```text
.
├── prisma/
│   ├── schema.prisma
│   └── schema-conversations.prisma
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── scripts/
├── src/
│   ├── app/
│   │   ├── api/
│   │   ├── chats/
│   │   ├── login/
│   │   └── settings/
│   ├── components/
│   │   ├── auth/
│   │   ├── chat/
│   │   ├── shell/
│   │   └── ui/
│   ├── hooks/
│   ├── lib/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── messages/
│   │   ├── notifications/
│   │   ├── phone/
│   │   ├── pubsub/
│   │   ├── time/
│   │   ├── types/
│   │   └── whatsapp/
│   ├── server/
│   │   ├── auth/
│   │   ├── controllers/
│   │   ├── db/
│   │   ├── export/
│   │   ├── media/
│   │   ├── pubsub/
│   │   ├── storage/
│   │   └── whatsapp/
│   └── stores/
├── mini-services/
├── examples/
├── ecosystem.config.js
├── middleware.ts
├── next.config.ts
└── package.json
```

## Core Areas

### App Router and Pages

- `src/app/layout.tsx`
  - global providers, theme, shell bootstrap
- `src/app/page.tsx`
  - chat home entry point
- `src/app/chats/page.tsx`
  - explicit chat page
- `src/app/login/page.tsx`
  - login entry
- `src/app/settings/page.tsx`
  - user-facing settings

### Internal API Routes

- `src/app/api/auth/*`
  - password login, OTP login, token login, session, logout, CSRF
- `src/app/api/conversations/*`
  - conversation list/detail, message send, labels, templates, exports, media, notes, profile image, pin/archive/mute/block
- `src/app/api/whatsapp/webhooks/route.ts`
  - inbound messages and status updates from Meta
- `src/app/api/pubsub/stream/route.ts`
  - internal stream route used by some live-update flows
- `src/app/api/version/route.ts`
  - build/version info

### Frontend Shell and Chat UI

- `src/components/shell/AppShell.tsx`
  - main app frame, live Pub/Sub wiring, notification flow, layout resizing
- `src/components/chat/ChatList.tsx`
  - sidebar, search, filters, labels, export-all menu
- `src/components/chat/ConversationView.tsx`
  - message thread, composer, message actions, template send flow, media viewer
- `src/components/chat/RightInfoPanel.tsx`
  - contact info, notes, labels, starred messages, profile image
- `src/components/chat/TemplatePickerDialog.tsx`
  - multi-step template selection, parameter fill, preview
- `src/components/auth/LoginForm.tsx`
  - password, OTP, and auth-token login entry UI

### Client State and API Layer

- `src/stores/chatStore.ts`
  - central Zustand store for conversations, messages, filters, selections, optimistic updates
- `src/lib/api/client.ts`
  - typed frontend API client for chat routes
- `src/lib/api/auth-client.ts`
  - typed frontend auth client
- `src/lib/types/chat.ts`
  - shared conversation, message, label, template, export, media, and response types
- `src/lib/types/pubsub.ts`
  - shared live-event payload contracts

### Server-Side Chat Logic

- `src/server/controllers/conversation-controller.ts`
  - main conversation/message business logic
  - service window checks
  - send flow
  - template send flow
  - status hydration
  - exports
  - notes/profile image handling
- `src/server/auth/auth-service.ts`
  - user lookup and login flows against the existing users table
- `src/server/auth/session.ts`
  - signed cookie sessions and CSRF helpers

### Database Access

- `prisma/schema.prisma`
  - main database schema model definitions
- `prisma/schema-conversations.prisma`
  - conversations database schema model definitions
- `src/server/db/mysql.ts`
  - main database access
- `src/server/db/conversations-db.ts`
  - conversations database access and typed row helpers
- `src/server/db/cloud-api-setup.ts`
  - Cloud API setup lookup and token resolution
- `src/server/db/cloud-whatsapp-templates.ts`
  - template lookup/parsing from the main database
- `src/server/db/chat-labels.ts`
  - label lookup from the main database

### Media, Templates, and WhatsApp Integration

- `src/server/storage/wasabi-storage.ts`
  - S3-compatible Wasabi storage operations
- `src/server/media/conversation-media-service.ts`
  - inbound/outbound media lifecycle
- `src/server/whatsapp/message-sender.ts`
  - WhatsApp send orchestration
- `src/server/whatsapp/media-upload.ts`
  - Meta media upload helpers
- `src/lib/messages/resolve-message-for-rendering.ts`
  - converts stored payloads into render-ready message content

### Real-Time Updates and Notifications

- `src/server/pubsub/pubsub-service.ts`
  - server-side publish/subscription integration
- `src/lib/pubsub/client.ts`
  - browser pub/sub transport client
- `src/hooks/use-pubsub.ts`
  - UI hook for live message/status events
- `src/lib/notifications/service.ts`
  - browser + service-worker notification delivery
- `public/sw.js`
  - service worker for offline support and notification click handling

## Main Runtime Flows

### 1. Login

1. User opens `/login`.
2. `LoginForm.tsx` calls `src/lib/api/auth-client.ts`.
3. `src/app/api/auth/*` routes delegate to `src/server/auth/auth-service.ts`.
4. `src/server/auth/session.ts` creates signed cookies.
5. `middleware.ts` and page-level checks protect chat routes.

### 2. Load Conversations

1. `ChatList.tsx` triggers `fetchConversations()` from `src/lib/api/client.ts`.
2. `/api/conversations` routes to `conversation-controller.ts`.
3. Controller reads from conversations DB and enriches with labels, service-window state, and latest status metadata.
4. `chatStore.ts` hydrates the sidebar and selection state.

### 3. Send a Message

1. `ConversationView.tsx` sends a typed payload through `src/lib/api/client.ts`.
2. `conversation-controller.ts` validates service window / template requirements.
3. WhatsApp send helpers upload media if needed and call Meta.
4. Message rows are written to the conversations DB.
5. Pub/Sub emits live events back into `AppShell.tsx` and `chatStore.ts`.

### 4. Receive a Message or Status Update

1. Meta calls `src/app/api/whatsapp/webhooks/route.ts`.
2. The webhook stores messages/status history and updates message rows.
3. `src/server/pubsub/pubsub-service.ts` publishes live events.
4. `src/lib/pubsub/client.ts` receives them in the browser.
5. `AppShell.tsx` forwards them into `chatStore.ts`.
6. `ConversationView.tsx` and `ChatList.tsx` re-render live.

## Databases

### Main Database

Contains shared application data such as:

- users
- cloud API setup
- WhatsApp templates
- chat labels
- auth-related user fields

Primary schema file: `prisma/schema.prisma`

### Conversations Database

Contains chat runtime data such as:

- conversations
- conversation messages
- message status history
- conversation-label relationships
- per-conversation notes/profile-image metadata

Primary schema file: `prisma/schema-conversations.prisma`

## Important Notes

- This project does not rely on automatic Prisma migrations for production schema changes. Database changes are applied manually, then reflected in the Prisma schema files.
- Several flows depend on both schema files and shared TypeScript types. If a field changes in the database, the matching Prisma schema, controller mapping, API types, and frontend renderers usually need updates together.
- Live status, template rendering, labels, notes, profile images, and service-window state all cross multiple layers. Check the top-of-file dependency notes in the core files before making structural changes.

## Common Commands

```bash
npm install
npm run dev
npm run build
npm run start
npm run db:generate
npm run pm2:restart
```

## Deployment Entry Points

- `ecosystem.config.js`
  - PM2 app definition
- `scripts/deploy.js`
  - deploy helper
- `version.txt`
  - deployed version source

## External Integrations

- WhatsApp Cloud API
- Wasabi S3 storage
- external Pub/Sub service (`pubsub-service.botmastersender.com`)
- browser Notification API / service worker

## Project Goal

This codebase is optimized around a WhatsApp-style operator inbox:

- one authenticated user session
- many conversations
- rich message/media rendering
- service-window enforcement
- template fallback when free-form messaging is closed
- real-time updates for incoming messages and delivery/read state
