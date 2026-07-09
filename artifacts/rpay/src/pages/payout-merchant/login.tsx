import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saveAuthAndRedirect } from "@/lib/auth";
import { Link, useLocation } from "wouter";
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

export default function PayoutMerchantLogin() {
  const [_, setLocation] = useLocation();
  const [isPending, setIsPending] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [debugState, setDebugState] = useState<LoginDebugState>(INITIAL_LOGIN_DEBUG_STATE);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email.trim().toLowerCase(),
          password: data.password,
        }),
      });

      if (res.status === 429) {
        const resetHeader =
          res.headers.get("RateLimit-Reset") ?? res.headers.get("ratelimit-reset");
        const seconds = resetHeader ? parseInt(resetHeader, 10) : 60;
        setRateLimitSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
        setDebugState({
          apiSuccess: false,
          tokenExists: false,
          role: "",
          merchantType: "",
          targetPath: "/payout-merchant/dashboard",
          redirectCalled: false,
        });
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as Record<string, unknown>)["message"] as string | undefined;
        setDebugState({
          apiSuccess: false,
          tokenExists: false,
          role: "",
          merchantType: "",
          targetPath: "/payout-merchant/dashboard",
          redirectCalled: false,
        });
        toast.error(msg || "Invalid credentials");
        return;
      }

      const body = (await res.json()) as Record<string, unknown>;

      const candidateUsers: unknown[] = [
        (body as Record<string, unknown>)["user"],
        ((body as Record<string, unknown>)["data"] as Record<string, unknown> | undefined)?.["user"],
        body,
      ];

      let role: string | undefined;
      let merchantType: string | undefined;
      let rawUser: Record<string, unknown> | undefined;
      for (const candidate of candidateUsers) {
        if (candidate && typeof candidate === "object") {
          const c = candidate as Record<string, unknown>;
          if (role === undefined && typeof c["role"] === "string") { role = c["role"] as string; rawUser = c; }
          if (merchantType === undefined && typeof c["merchantType"] === "string") {
            merchantType = c["merchantType"] as string;
          }
        }
      }
      if (merchantType === undefined && typeof body["merchantType"] === "string") {
        merchantType = body["merchantType"] as string;
      }

      const token = (body["token"] as string | undefined) ?? "";

      const targetPath = "/payout-merchant/dashboard";

      if (!(role === "merchant" && merchantType === "PAYOUT_ONLY")) {
        setDebugState({
          apiSuccess: true,
          tokenExists: !!token,
          role: role || "",
          merchantType: merchantType || "",
          targetPath,
          redirectCalled: false,
        });
        toast.error("This portal is for Payout merchants only. Please use the regular merchant login.");
        return;
      }

      if (!token) {
        setDebugState({
          apiSuccess: true,
          tokenExists: false,
          role: role || "",
          merchantType: merchantType || "",
          targetPath,
          redirectCalled: false,
        });
        toast.error("Login failed. Please try again.");
        return;
      }

      // marker: payout-active-login-hardredirect-v3 / live-login-debug-hardredirect-v4
      // Persist token/user to every storage key any guard could read, then
      // force a REAL full-page navigation (assign + href + replace,
      // staggered) directly in this success branch — before any return,
      // not inside a useEffect, not gated on auth-context state resolving.
      toast.success("Welcome to your Payout Portal.");
      setDebugState({
        apiSuccess: true,
        tokenExists: true,
        role: role || "",
        merchantType: merchantType || "",
        targetPath,
        redirectCalled: false,
      });
      saveAuthAndRedirect(
        token,
        { ...(rawUser ?? {}), role, merchantType },
        targetPath,
        (d) =>
          setDebugState({
            apiSuccess: d.apiSuccess,
            tokenExists: d.tokenPresent,
            role: d.role,
            merchantType: d.merchantType,
            targetPath: d.targetPath,
            redirectCalled: d.redirectCalled,
          })
      );
      return;
    } catch {
      setDebugState({
        apiSuccess: false,
        tokenExists: false,
        role: "",
        merchantType: "",
        targetPath: "/payout-merchant/dashboard",
        redirectCalled: false,
      });
      toast.error("Network error. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AuthLayout title="Payout Merchant Portal" subtitle="Sign in to your RasoKart Payout account">
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
                    autoCorrect="off"
                    autoCapitalize="none"
                    placeholder="merchant@example.com"
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
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    disabled={rateLimitSeconds !== null}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={isPending || rateLimitSeconds !== null}
          >
            {isPending ? "Authenticating..." : "Sign in"}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            <Link href="/" className="text-primary hover:underline">← Back to RasoKart</Link>
          </div>
          <div className="text-center text-xs text-muted-foreground/40 pt-2">
            Login Build: payout-active-login-hardredirect-v3 / live-login-debug-hardredirect-v4
          </div>
        </form>
        <LoginDebugPanel state={debugState} />
      </Form>
    </AuthLayout>
  );
}
