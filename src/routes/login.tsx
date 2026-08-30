import { createFileRoute } from "@tanstack/react-router";
import { LoginScreen } from "@/components/auth/LoginScreen";

export const Route = createFileRoute("/login")({
  component: LoginScreen,
});
