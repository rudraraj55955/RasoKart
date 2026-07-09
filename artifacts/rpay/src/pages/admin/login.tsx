import { useState, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, UserRole } from "@workspace/api-client-react";
import { saveAuthAndRedirect } from "@/lib/auth";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RateLimitBanner } from "@/components/ui/rate-limit-banner";
import { LoginDebugPanel, INITIAL_LOGIN_DEBUG_STATE, type LoginDebugState } from "@/components/login-debug-panel";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [debugState, setDebugState] = useState<LoginDebugState>(INITIAL_LOGIN_DEBUG_STATE);

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
            setDebugState({
              apiSuccess: true,
              tokenExists: !!res.token,
              role: res.user.role,
              merchantType: (res.user as unknown as Record<string, unknown>)["merchantType"] as string || "",
              targetPath: "/admin/dashboard",
              redirectCalled: false,
            });
            toast.error("Unauthorized. Admin access required.");
            return;
          }
          // marker: admin-active-login-hardredirect-v3 / live-login-debug-hardredirect-v4
          // Persist token/user to every storage key any guard could read,
          // then force a REAL full-page navigation (assign + href + replace,
          // staggered) directly in this success branch — before any return,
          // not inside a useEffect, not gated on auth-context state resolving.
          toast.success("Welcome back, Admin.");
          const targetPath = "/admin/dashboard";
          const userRecord = res.user as unknown as Record<string, unknown>;
          setDebugState({
            apiSuccess: true,
            tokenExists: !!res.token,
            role: res.user.role,
            merchantType: (userRecord["merchantType"] as string) || "",
            targetPath,
            redirectCalled: false,
          });
          saveAuthAndRedirect(res.token, userRecord, targetPath, (d) =>
            setDebugState({
              apiSuccess: d.apiSuccess,
              tokenExists: d.tokenPresent,
              role: d.role,
              merchantType: d.merchantType,
              targetPath: d.targetPath,
              redirectCalled: d.redirectCalled,
            })
          );
        },
        onError: (err) => {
          const e = err as unknown as Record<string, unknown>;
          setDebugState({
            apiSuccess: false,
            tokenExists: false,
            role: "",
            merchantType: "",
            targetPath: "/admin/dashboard",
            redirectCalled: false,
          });
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
            Login Build: admin-active-login-hardredirect-v3 / live-login-debug-hardredirect-v4
          </div>
        </form>
      </Form>
      <LoginDebugPanel state={debugState} />
    </AuthLayout>
  );
}
