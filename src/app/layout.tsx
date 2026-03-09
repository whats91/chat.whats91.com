import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#45BC96" },
    { media: "(prefers-color-scheme: dark)", color: "#2d8a6e" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Whats91 Chat - WhatsApp Business Platform",
    template: "%s | Whats91",
  },
  description: "Multi-tenant WhatsApp Business chat platform with Cloud API integration for seamless customer communication.",
  keywords: ["WhatsApp", "Business API", "Chat", "Multi-tenant", "Customer Service", "Messaging", "PWA"],
  authors: [{ name: "Whats91 Team" }],
  
  // PWA
  manifest: "/manifest.json",
  
  // Icons
  icons: {
    icon: [
      { url: "/images/icon.png", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/images/icon.png", type: "image/png" },
    ],
  },
  
  // Open Graph
  openGraph: {
    title: "Whats91 Chat - WhatsApp Business Platform",
    description: "Multi-tenant WhatsApp Business chat platform with Cloud API integration",
    type: "website",
    siteName: "Whats91 Chat",
  },
  
  // Twitter
  twitter: {
    card: "summary_large_image",
    title: "Whats91 Chat",
    description: "WhatsApp Business Platform for modern customer communication",
  },
  
  // Apple specific
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Whats91 Chat",
  },
  
  // Other
  formatDetection: {
    telephone: true,
    email: true,
    address: true,
  },
  applicationName: "Whats91 Chat",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA meta tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Whats91 Chat" />
        <meta name="application-name" content="Whats91 Chat" />
        <meta name="msapplication-TileColor" content="#45BC96" />
        <meta name="msapplication-tap-highlight" content="no" />
        
        {/* Theme colors */}
        <meta name="theme-color" content="#45BC96" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#2d8a6e" media="(prefers-color-scheme: dark)" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="whats91-theme-mode"
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
