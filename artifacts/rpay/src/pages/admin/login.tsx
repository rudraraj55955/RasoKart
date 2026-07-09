import { useState, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, UserRole } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { setToken, setStoredUser, setLegacyAuthKeys } from "@/lib/auth";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RateLimitBanner } from "@/components/ui/rate-limit-banner";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const { login: setAuthToken } = useAuth();
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
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
            toast.error("Unauthorized. Admin access required.");
            return;
          }
          // Write token + user to the exact storage keys the admin route
          // guard reads (localStorage AND sessionStorage), synchronously,
          // BEFORE navigating. Then do a hard redirect instead of relying on
          // React/wouter navigation + auth context state — this guarantees
          // the destination route's very first render already sees valid auth.
          setToken(res.token);
          setStoredUser(res.user as unknown as Record<string, unknown>);
          setLegacyAuthKeys(res.token, res.user as unknown as Record<string, unknown>);
          setAuthToken(res.token);
          toast.success("Welcome back, Admin.");
          window.location.replace("/admin/dashboard");
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
          toast.error(e["message"] as string || "Login failed");
        },
      }
    );
  };

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
                  <Input placeholder="admin@rasokart.com" disabled={rateLimitSeconds !== null} {...field} />
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
                  <Input type="password" placeholder="••••••••" disabled={rateLimitSeconds !== null} {...field} />
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
            {loginMutation.isPending ? "Authenticating..." : "Sign in"}
          </Button>
          <div className="text-center text-xs text-muted-foreground/40 pt-2">
            Login Build: admin-login-one-shot-fix-v2
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
