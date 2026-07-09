import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth-context";
import { setToken } from "@/lib/auth";
import { Link, useLocation } from "wouter";
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

export default function PayoutMerchantLogin() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);

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
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as Record<string, unknown>)["message"] as string | undefined;
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
      for (const candidate of candidateUsers) {
        if (candidate && typeof candidate === "object") {
          const c = candidate as Record<string, unknown>;
          if (role === undefined && typeof c["role"] === "string") role = c["role"] as string;
          if (merchantType === undefined && typeof c["merchantType"] === "string") {
            merchantType = c["merchantType"] as string;
          }
        }
      }
      if (merchantType === undefined && typeof body["merchantType"] === "string") {
        merchantType = body["merchantType"] as string;
      }

      const token = (body["token"] as string | undefined) ?? "";

      if (role !== "merchant" && role !== "payout_merchant") {
        toast.error("Unauthorized. Payout Merchant access required.");
        return;
      }

      if (!(role === "merchant" && merchantType === "PAYOUT_ONLY") && merchantType !== "BOTH" && role !== "payout_merchant") {
        toast.error("This portal is for Payout merchants only. Please use the regular merchant login.");
        return;
      }

      if (!token) {
        toast.error("Login failed. Please try again.");
        return;
      }

      // Write the token to the same storage key/context the protected
      // payout-merchant routes read from BEFORE navigating, so the route
      // guard never sees a stale/empty auth state on the first render of
      // the destination route.
      setToken(token);
      setAuthToken(token);
      toast.success("Welcome to your Payout Portal.");
      setLocation("/payout-merchant/dashboard", { replace: true } as Parameters<typeof setLocation>[1]);
    } catch {
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
            Login Build: payout-login-redirect-fix-v1
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
