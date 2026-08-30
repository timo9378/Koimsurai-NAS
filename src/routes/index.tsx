import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { DesktopLayout } from "@/components/desktop/DesktopLayout";
import { Dock } from "@/components/desktop/Dock";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { useCheckAuth } from "@/features/auth/api/useAuth";
import { useIsMobile } from "@/hooks/useIsMobile";

function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const checkAuth = useCheckAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        await checkAuth.mutateAsync();
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      }
    };
    void verifyAuth();
    // 只在掛載時驗一次；checkAuth 是 mutation，放進相依會每次 render 重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export const Route = createFileRoute("/")({
  component: Home,
});
