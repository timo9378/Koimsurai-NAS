"use client"

import { useEffect, useState } from 'react';
import { DesktopLayout } from '@/components/desktop/DesktopLayout';
import { Dock } from '@/components/desktop/Dock';
import { MobileLayout } from '@/components/mobile/MobileLayout';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { useCheckAuth } from '@/features/auth/api/useAuth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const checkAuth = useCheckAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        await checkAuth.mutateAsync();
        setIsAuthenticated(true);
      } catch (error) {
        setIsAuthenticated(false);
      }
    };
    verifyAuth();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  if (isMobile) {
    return <MobileLayout />;
  }

  return (
    <DesktopLayout>
      <Dock />
    </DesktopLayout>
  );
}
