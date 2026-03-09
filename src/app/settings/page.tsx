'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle,
  XCircle,
  Phone,
  Key,
  Globe,
  Shield,
  Bell,
} from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useNotifications } from '@/hooks/use-notifications';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  updateNotificationPreference,
  type NotificationPreferences,
} from '@/lib/notifications/preferences';

export default function SettingsPage() {
  const { isSocketConnected } = useChatStore();
  const { 
    supported: notificationsSupported, 
    isGranted, 
    requestPermission 
  } = useNotifications();
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES
  );

  useEffect(() => {
    setPreferences(getNotificationPreferences());
  }, []);

  const handlePreferenceChange = (
    key: keyof NotificationPreferences,
    value: boolean
  ) => {
    const nextPreferences = updateNotificationPreference(key, value);
    setPreferences(nextPreferences);
  };
  
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your WhatsApp Business account and channel configuration
          </p>
        </div>
        
        <Tabs defaultValue="channel" className="space-y-6">
          <TabsList>
            <TabsTrigger value="channel">Channel Setup</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          
          <TabsContent value="channel" className="space-y-6">
            {/* Connection Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  WhatsApp Channel
                </CardTitle>
                <CardDescription>
                  Your WhatsApp Business API connection status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Real-time Connection</Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {isSocketConnected ? 'Connected' : 'Disconnected'}
                      </span>
                      {isSocketConnected ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Configuration Status</Label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Setup Required</Badge>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <p className="text-sm text-muted-foreground">
                  Configure your WhatsApp Business API credentials to enable messaging.
                  You can set up your credentials through the environment configuration.
                </p>
              </CardContent>
            </Card>
            
            {/* Access Token */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Access Token
                </CardTitle>
                <CardDescription>
                  Manage your WhatsApp Business API access token
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="token">Access Token</Label>
                  <Input
                    id="token"
                    type="password"
                    placeholder="Configure via environment variables"
                    className="font-mono"
                    disabled
                  />
                  <p className="text-xs text-muted-foreground">
                    Set WHATSAPP_ACCESS_TOKEN in your environment configuration
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notification Settings
                </CardTitle>
                <CardDescription>
                  Configure how you receive alerts and notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Browser Notification Permission */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Browser Notifications</p>
                    <p className="text-sm text-muted-foreground">
                      {notificationsSupported 
                        ? (isGranted 
                            ? 'Enabled - You will receive notifications for new messages'
                            : 'Click to enable desktop notifications')
                        : 'Not supported in this browser'}
                    </p>
                  </div>
                  {notificationsSupported && !isGranted && (
                    <Button onClick={requestPermission} size="sm">
                      Enable
                    </Button>
                  )}
                  {isGranted && (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">New message alerts</p>
                    <p className="text-sm text-muted-foreground">
                      Get notified when you receive new messages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.newMessages}
                    onChange={(event) =>
                      handlePreferenceChange('newMessages', event.target.checked)
                    }
                    className="toggle toggle-primary"
                  />
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Delivery status updates</p>
                    <p className="text-sm text-muted-foreground">
                      Track message delivery and read status
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.deliveryStatus}
                    onChange={(event) =>
                      handlePreferenceChange('deliveryStatus', event.target.checked)
                    }
                    className="toggle toggle-primary"
                  />
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Sound notifications</p>
                    <p className="text-sm text-muted-foreground">
                      Play sound for new messages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.sound}
                    onChange={(event) =>
                      handlePreferenceChange('sound', event.target.checked)
                    }
                    className="toggle toggle-primary"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="webhooks" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Webhook Configuration
                </CardTitle>
                <CardDescription>
                  Configure webhook endpoints for receiving WhatsApp events
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <Input
                    id="webhook-url"
                    placeholder="/api/whatsapp/webhooks"
                    className="font-mono"
                    disabled
                    value="/api/whatsapp/webhooks"
                  />
                  <p className="text-xs text-muted-foreground">
                    This is your webhook endpoint for Meta WhatsApp Business API
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="verify-token">Verify Token</Label>
                  <Input
                    id="verify-token"
                    type="password"
                    placeholder="Configure via WHATSAPP_WEBHOOK_VERIFY_TOKEN"
                    disabled
                  />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security
                </CardTitle>
                <CardDescription>
                  Webhook signature verification settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="app-secret">App Secret</Label>
                  <Input
                    id="app-secret"
                    type="password"
                    placeholder="Configure via WHATSAPP_APP_SECRET"
                    disabled
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to verify X-Hub-Signature-256 header on incoming webhooks
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="about" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>About Whats91 Chat</CardTitle>
                <CardDescription>
                  Application information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Version</Label>
                  <span className="font-mono text-sm">1.0.0</span>
                </div>
                
                <Separator />
                
                <div className="grid gap-2">
                  <Label>PWA Status</Label>
                  <Badge variant="outline">Installable</Badge>
                </div>
                
                <Separator />
                
                <div className="grid gap-2">
                  <Label>Features</Label>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Real-time messaging via WebSocket</li>
                    <li>• Offline support with service worker</li>
                    <li>• Cross-browser notifications</li>
                    <li>• WhatsApp Cloud API integration</li>
                    <li>• PWA installable on mobile devices</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
