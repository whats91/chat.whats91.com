import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { getAuthenticatedUser } from '@/server/auth/session';

interface LoginPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = (await searchParams) || {};
  const authTokenParam = resolvedSearchParams.auth_token;
  const hasAuthToken =
    typeof authTokenParam === 'string'
      ? authTokenParam.trim().length > 0
      : Array.isArray(authTokenParam)
        ? authTokenParam.some((value) => value.trim().length > 0)
        : false;
  const user = await getAuthenticatedUser();
  if (user && !hasAuthToken) {
    redirect('/');
  }

  return <LoginForm />;
}
