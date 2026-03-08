import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getAuthenticatedUser } from '@/server/auth/session';

export default async function HomePage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  return <AppShell />;
}
