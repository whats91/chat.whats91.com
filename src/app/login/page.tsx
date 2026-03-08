import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { getAuthenticatedUser } from '@/server/auth/session';

export default async function LoginPage() {
  const user = await getAuthenticatedUser();
  if (user) {
    redirect('/');
  }

  return <LoginForm />;
}
