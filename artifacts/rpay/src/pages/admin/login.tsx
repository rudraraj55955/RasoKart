import { useState, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, UserRole } from "@workspace/api-client-react";
import { saveAuthAndRedirect } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RateLimitBanner } from "@/components/ui/rate-limit-banner";
import { Eye, EyeOff } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    form.reset();
  }, []);

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.user.role !== UserRole.admin) {
            toast.error("This account is not authorised for the Admin Portal.");
            return;
          }
          setSigningIn(true);
          queryClient.clear();
          saveAuthAndRedirect(
            res.token,
            res.user as unknown as Record<string, unknown>,
            "/admin/dashboard",
          );
        },
        onError: (err) => {
          const e = err as unknown as Record<string, unknown>;
          if (e["status"] === 429) {
            const headers = e["headers"] as Headers | undefined;
            const resetHeader = headers?.get("RateLimit-Reset") ?? headers?.get("ratelimit-reset");
            const seconds = resetHeader ? parseInt(resetHeader, 10) : 60;
            setRateLimitSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
            return;
          }
          toast.error((e["message"] as string) || "Login failed");
        },
      }
    );
  };

  if (signingIn) {
    return (
      <AuthLayout title="Admin Portal" subtitle="Sign in to RasoKart operations">
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm">Signing you in…</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Admin Portal" subtitle="Sign in to RasoKart operations">
      {rateLimitSeconds !== null && (
        <div className="mb-6">
          <RateLimitBanner
            retryAfterSeconds={rateLimitSeconds}
            message="Too many login attempts. Please wait before trying again."
            onDismiss={() => { setRateLimitSeconds(null); form.reset(); }}
          />
        </div>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="admin@rasokart.com"
                    disabled={rateLimitSeconds !== null}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      disabled={rateLimitSeconds !== null}
                      className="pr-10"
                      {...field}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((s) => !s)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending || rateLimitSeconds !== null}
          >
            {loginMutation.isPending ? "Authenticating…" : "Sign in"}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}
