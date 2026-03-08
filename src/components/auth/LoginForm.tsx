'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LockKeyhole, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  fetchCsrfToken,
  loginWithPassword,
  requestOtpLogin,
  verifyOtpLogin,
} from '@/lib/api/auth-client';
import { clearCurrentUserId, setCurrentUserId } from '@/lib/config/current-user';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function resolveNextPath(nextParam: string | null): string {
  if (!nextParam || !nextParam.startsWith('/') || nextParam.startsWith('//')) {
    return '/';
  }

  return nextParam;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => resolveNextPath(searchParams.get('next')), [searchParams]);

  const [csrfToken, setCsrfToken] = useState('');
  const [activeTab, setActiveTab] = useState<'password' | 'otp'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otpPhone, setOtpPhone] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOtpPending, setIsOtpPending] = useState(false);

  async function refreshCsrfToken() {
    const token = await fetchCsrfToken();
    setCsrfToken(token);
    return token;
  }

  useEffect(() => {
    void refreshCsrfToken();
  }, []);

  async function handleAuthSuccess(userId: string) {
    setCurrentUserId(userId);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('whats91-chat-store');
    }

    router.replace(nextPath);
    router.refresh();
  }

  async function withFreshCsrf<T>(action: (token: string) => Promise<T>): Promise<T> {
    const token = csrfToken || (await refreshCsrfToken());
    return action(token);
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identifier.trim() || !password) {
      toast({
        title: 'Missing credentials',
        description: 'Enter your username and password to continue.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await withFreshCsrf((token) =>
        loginWithPassword(
          {
            identifier: identifier.trim(),
            password,
          },
          token
        )
      );

      if (!response.success || !response.user) {
        throw new Error(response.message || 'Failed to log in');
      }

      toast({
        title: 'Logged in',
        description: 'Your session will stay active for 90 days on this device.',
      });
      await handleAuthSuccess(response.user.id);
    } catch (error) {
      clearCurrentUserId();
      toast({
        title: 'Login failed',
        description: error instanceof Error ? error.message : 'Unable to log in',
        variant: 'destructive',
      });
      await refreshCsrfToken();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOtpRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!otpPhone.trim()) {
      toast({
        title: 'Phone required',
        description: 'Enter the phone number linked to your account.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await withFreshCsrf((token) =>
        requestOtpLogin(
          {
            phone: otpPhone.trim(),
          },
          token
        )
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to request OTP');
      }

      setMaskedPhone(String(response.data?.maskedPhone || ''));
      setIsOtpPending(true);
      setOtpValue('');

      toast({
        title: 'OTP sent',
        description: response.message,
      });
    } catch (error) {
      toast({
        title: 'OTP request failed',
        description: error instanceof Error ? error.message : 'Unable to send OTP',
        variant: 'destructive',
      });
      await refreshCsrfToken();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOtpVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (otpValue.length !== 6) {
      toast({
        title: 'OTP required',
        description: 'Enter the 6-digit OTP to continue.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await withFreshCsrf((token) =>
        verifyOtpLogin(
          {
            phone: otpPhone.trim(),
            otp: otpValue,
          },
          token
        )
      );

      if (!response.success || !response.user) {
        throw new Error(response.message || 'Failed to verify OTP');
      }

      toast({
        title: 'Logged in',
        description: 'OTP verification completed successfully.',
      });
      await handleAuthSuccess(response.user.id);
    } catch (error) {
      clearCurrentUserId();
      toast({
        title: 'OTP verification failed',
        description: error instanceof Error ? error.message : 'Unable to verify OTP',
        variant: 'destructive',
      });
      await refreshCsrfToken();
    } finally {
      setIsLoading(false);
    }
  }

  function resetOtpFlow() {
    setIsOtpPending(false);
    setMaskedPhone(null);
    setOtpValue('');
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(69,188,150,0.18),_transparent_30%),linear-gradient(160deg,_hsl(var(--background))_0%,_hsl(var(--muted))_100%)]">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-10">
        <section className="relative overflow-hidden rounded-[2rem] border bg-card/80 p-6 shadow-sm backdrop-blur sm:p-10">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(69,188,150,0.12),transparent_55%)]" />
          <div className="relative flex h-full flex-col justify-between gap-10">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Secure chat access
              </div>
              <div className="space-y-3">
                <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  Sign in to Whats91 Chat
                </h1>
                <p className="max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
                  Use your existing account from the main platform. Sessions stay active for 90 days,
                  and all chat data stays isolated to the authenticated user.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: LockKeyhole,
                  title: 'Password login',
                  copy: 'Supports existing bcrypt-hashed credentials from the users table.',
                },
                {
                  icon: MessageSquareText,
                  title: 'OTP login',
                  copy: 'Sends a WhatsApp OTP to the number already linked to the account.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Session security',
                  copy: 'Signed cookies, CSRF checks, and user-scoped API access on every request.',
                },
              ].map((item) => (
                <Card key={item.title} className="border-border/70 bg-background/70 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <item.icon className="h-5 w-5 text-primary" />
                    <div className="space-y-1.5">
                      <h2 className="text-sm font-semibold text-foreground">{item.title}</h2>
                      <p className="text-sm leading-6 text-muted-foreground">{item.copy}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <Card className="w-full rounded-[2rem] border bg-background/95 shadow-xl shadow-black/5">
            <CardContent className="p-5 sm:p-8">
              <div className="mb-6 space-y-1">
                <h2 className="text-2xl font-semibold text-foreground">Welcome back</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Choose the login method that matches your account setup.
                </p>
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(value) => {
                  setActiveTab(value as 'password' | 'otp');
                }}
                className="space-y-6"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="password">Username & Password</TabsTrigger>
                  <TabsTrigger value="otp">Login with OTP</TabsTrigger>
                </TabsList>

                <TabsContent value="password">
                  <form className="space-y-5" onSubmit={handlePasswordSubmit}>
                    <div className="space-y-2">
                      <Label htmlFor="identifier">Username</Label>
                      <Input
                        id="identifier"
                        autoComplete="username"
                        placeholder="Enter your username"
                        value={identifier}
                        onChange={(event) => setIdentifier(event.target.value)}
                        disabled={isLoading}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={isLoading}
                      />
                    </div>

                    <Button className="w-full" type="submit" disabled={isLoading}>
                      {isLoading && activeTab === 'password' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Continue to chat
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="otp">
                  <div className="space-y-5">
                    <form className="space-y-5" onSubmit={handleOtpRequest}>
                      <div className="space-y-2">
                        <Label htmlFor="otp-phone">Phone number</Label>
                        <Input
                          id="otp-phone"
                          autoComplete="tel"
                          placeholder="Enter your WhatsApp number"
                          value={otpPhone}
                          onChange={(event) => setOtpPhone(event.target.value)}
                          disabled={isLoading || isOtpPending}
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          The OTP is sent to the phone number already stored on your user record.
                        </p>
                      </div>

                      <Button className="w-full" type="submit" disabled={isLoading || isOtpPending}>
                        {isLoading && activeTab === 'otp' && !isOtpPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Send OTP
                      </Button>
                    </form>

                    <div
                      className={cn(
                        'rounded-2xl border border-dashed p-4 transition-opacity',
                        isOtpPending ? 'opacity-100' : 'pointer-events-none opacity-50'
                      )}
                    >
                      <form className="space-y-4" onSubmit={handleOtpVerify}>
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-foreground">Enter the 6-digit OTP</h3>
                          <p className="text-sm text-muted-foreground">
                            {maskedPhone
                              ? `Code sent to ${maskedPhone}. It stays valid for 10 minutes.`
                              : 'Request an OTP first.'}
                          </p>
                        </div>

                        <div className="flex justify-center">
                          <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue} disabled={!isOtpPending || isLoading}>
                            <InputOTPGroup>
                              <InputOTPSlot index={0} />
                              <InputOTPSlot index={1} />
                              <InputOTPSlot index={2} />
                            </InputOTPGroup>
                            <InputOTPSeparator />
                            <InputOTPGroup>
                              <InputOTPSlot index={3} />
                              <InputOTPSlot index={4} />
                              <InputOTPSlot index={5} />
                            </InputOTPGroup>
                          </InputOTP>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row">
                          <Button className="flex-1" type="submit" disabled={!isOtpPending || isLoading}>
                            {isLoading && activeTab === 'otp' && isOtpPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Verify OTP
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={resetOtpFlow}
                            disabled={isLoading}
                          >
                            Change number
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
