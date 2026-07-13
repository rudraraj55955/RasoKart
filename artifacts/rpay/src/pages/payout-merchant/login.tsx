import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saveAuthAndRedirect } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff } from "lucide-react";
import { RateLimitBanner } from "@/components/ui/rate-limit-banner";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export default function PayoutMerchantLogin() {
  const [isPending, setIsPending] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
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
        const resetHeader = res.headers.get("RateLimit-Reset") ?? res.headers.get("ratelimit-reset");
        const seconds = resetHeader ? parseInt(resetHeader, 10) : 60;
        setRateLimitSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as Record<string, unknown>)["error"] as string
          ?? (body as Record<string, unknown>)["message"] as string
          ?? "Invalid credentials";
        toast.error(msg);
        return;
      }

      const body = (await res.json()) as Record<string, unknown>;
      const userObj = (body["user"] as Record<string, unknown> | undefined) ?? body;
      const role = typeof userObj["role"] === "string" ? userObj["role"] : "";
      const merchantType = typeof userObj["merchantType"] === "string" ? userObj["merchantType"] : "";
      const token = typeof body["token"] === "string" ? body["token"] : "";

      if (!token) {
        toast.error("Login failed. Please try again.");
        return;
      }

      if (!(role === "merchant" && merchantType === "PAYOUT_ONLY")) {
        toast.error("This portal is for Payout merchants only. Please use the regular merchant login.");
        return;
      }

      toast.success("Welcome to your Payout Portal.");
      setSigningIn(true);
      queryClient.clear();
      saveAuthAndRedirect(
        token,
        { ...userObj, role, merchantType },
        "/payout-merchant/dashboard",
      );
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  if (signingIn) {
    return (
      <AuthLayout title="Payout Merchant Portal" subtitle="Sign in to your RasoKart Payout account">
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm">Signing you in…</p>
        </div>
      </AuthLayout>
    );
  }

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
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
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
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <span className="text-xs text-muted-foreground">
                    <a href="mailto:support@rasokart.com" className="text-primary hover:underline">
                      Forgot password?
                    </a>
                  </span>
                </div>
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
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((s) => !s)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={rateLimitSeconds !== null}
                  />
                </FormControl>
                <FormLabel className="text-sm font-normal cursor-pointer">Remember me</FormLabel>
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="w-full"
            disabled={isPending || rateLimitSeconds !== null}
          >
            {isPending ? "Signing in…" : "Sign in"}
          </Button>

          <div className="text-center text-sm text-muted-foreground space-y-2">
            <p>
              New to RasoKart Payouts?{" "}
              <Link href="/payout-merchant/signup" className="text-primary hover:underline font-medium">
                Create an account
              </Link>
            </p>
            <p>
              <Link href="/" className="text-muted-foreground/60 hover:text-muted-foreground text-xs">
                ← Back to RasoKart
              </Link>
            </p>
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
