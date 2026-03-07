# 🚀 Whats91 Chat

A modern, production-ready WhatsApp Business chat platform powered by cutting-edge technologies, designed for multi-tenant customer communication.

## ✨ Technology Stack

This platform provides a robust foundation built with:

### 🎯 Core Framework
- **⚡ Next.js 16** - The React framework for production with App Router
- **📘 TypeScript 5** - Type-safe JavaScript for better developer experience
- **🎨 Tailwind CSS 4** - Utility-first CSS framework for rapid UI development

### 🧩 UI Components & Styling
- **🧩 shadcn/ui** - High-quality, accessible components built on Radix UI
- **🎯 Lucide React** - Beautiful & consistent icon library
- **🌈 Framer Motion** - Production-ready motion library for React
- **🎨 Next Themes** - Perfect dark mode in 2 lines of code

### 📋 Forms & Validation
- **🎣 React Hook Form** - Performant forms with easy validation
- **✅ Zod** - TypeScript-first schema validation

### 🔄 State Management & Data Fetching
- **🐻 Zustand** - Simple, scalable state management
- **🔄 TanStack Query** - Powerful data synchronization for React
- **🌐 Fetch** - Promise-based HTTP request

### 🗄️ Database & Backend
- **🗄️ Prisma** - Next-generation TypeScript ORM
- **🔐 NextAuth.js** - Complete open-source authentication solution

### 🎨 Advanced UI Features
- **📊 TanStack Table** - Headless UI for building tables and datagrids
- **🖱️ DND Kit** - Modern drag and drop toolkit for React
- **📊 Recharts** - Redefined chart library built with React and D3
- **🖼️ Sharp** - High performance image processing

### 🌍 Internationalization & Utilities
- **🌍 Next Intl** - Internationalization library for Next.js
- **📅 Date-fns** - Modern JavaScript date utility library
- **🪝 ReactUse** - Collection of essential React hooks for modern development

### 📱 PWA Support
- ** Progressive Web App** - Installable on Android and iOS devices
- **🔔 Push Notifications** - Real-time message alerts
- **📡 Offline Support** - Service worker caching for offline access

## 🎯 Why Whats91 Chat?

- **🏎️ Real-time Messaging** - WebSocket-powered live chat with pub/sub events
- **📱 WhatsApp Business API** - Full Cloud API integration
- **🏢 Multi-tenant** - Support for multiple business accounts
- **🔒 Type Safety** - Full TypeScript configuration with Zod validation
- **📱 Responsive** - Mobile-first design principles with smooth animations
- **🗄️ Dual Database** - Separate databases for main app and conversations
- **🔐 Auth Included** - NextAuth.js for secure authentication flows
- **🚀 Production Ready** - PM2 configuration for CloudPanel deployment

## 🚀 Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Start production server
bun start
```

Open [http://localhost:3000](http://localhost:3000) to see your application running.

## 🌐 Production Deployment

For production deployment on CloudPanel:

```bash
# Build and deploy
bun run deploy

# Or with fresh install
bun run deploy:fresh
```

## 📁 Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   └── api/            # API routes (conversations, webhooks)
├── components/          # Reusable React components
│   ├── chat/           # Chat-specific components
│   ├── shell/          # App shell and layout
│   └── ui/             # shadcn/ui components
├── hooks/              # Custom React hooks
├── lib/                # Utility functions and configurations
├── server/             # Server-side logic
│   ├── controllers/    # HTTP request handlers
│   ├── pubsub/        # Real-time pub/sub service
│   └── whatsapp/      # WhatsApp Cloud API integration
└── stores/             # Zustand state stores
```

## 🎨 Available Features

### 💬 Chat Features
- **Real-time Messaging** - Live message updates via WebSocket
- **Conversation Management** - Archive, pin, mute conversations
- **Message Status** - Sent, delivered, read indicators
- **Media Support** - Images, videos, documents, audio
- **Search** - Find conversations and messages

### 🔔 Notifications
- **Browser Notifications** - Cross-browser support
- **Message Previews** - See message content in notifications
- **Click Actions** - Navigate directly to conversations

### 📱 PWA Features
- **Installable** - Add to home screen on mobile
- **Offline Support** - Basic functionality without internet
- **Push Ready** - Configured for push notifications

### 🔐 Backend Integration
- **Authentication** - Ready-to-use auth flows with NextAuth.js
- **Database** - Type-safe database operations with Prisma
- **API Client** - HTTP requests with Fetch + TanStack Query
- **State Management** - Simple and scalable with Zustand

## 🔗 Links

- **Website**: [whats91.com](https://whats91.com)
- **Documentation**: [docs.whats91.com](https://docs.whats91.com)

---

Built with ❤️ for the Whats91 community 🚀
