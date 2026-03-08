'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-6 sm:px-6 lg:max-w-lg lg:px-8 lg:py-10">
        <section className="w-full">
          <Card className="w-full rounded-[2rem] border bg-background/95 shadow-xl shadow-black/5">
            <CardContent className="p-5 sm:p-8">
              <div className="mb-6">
                <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(value) => {
                  setActiveTab(value as 'password' | 'otp');
                }}
                className="space-y-6"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="password">Password</TabsTrigger>
                  <TabsTrigger value="otp">OTP</TabsTrigger>
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
                          <h3 className="text-sm font-semibold text-foreground">Enter the 6-digit code</h3>
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

              <div className="mt-6 text-center">
                <Link
                  href="https://whats91.com"
                  className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
                >
                  Back to Whats91
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
