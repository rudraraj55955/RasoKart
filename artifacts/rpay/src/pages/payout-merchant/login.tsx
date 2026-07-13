import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRequestMerchantOtp, useVerifyMerchantOtp, UserRole } from "@workspace/api-client-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const RESEND_COOLDOWN_SECONDS = 60;

function extractRateLimitSeconds(headers: Headers): number {
  const h = headers.get("RateLimit-Reset") ?? headers.get("ratelimit-reset");
  const s = h ? parseInt(h, 10) : 60;
  return Number.isFinite(s) && s > 0 ? s : 60;
}

// ---------- Password tab ----------

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});
type LoginFormValues = z.infer<typeof loginSchema>;

function PasswordLoginTab({
  onRateLimited,
  onSigningIn,
}: {
  onRateLimited: (s: number) => void;
  onSigningIn: () => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
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
        const seconds = extractRateLimitSeconds(res.headers);
        setRateLimitSeconds(seconds);
        onRateLimited(seconds);
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

      if (!token) { toast.error("Login failed. Please try again."); return; }

      if (!(role === "merchant" && merchantType === "PAYOUT_ONLY")) {
        toast.error("This portal is for Payout merchants only. Please use the regular merchant login.");
        return;
      }

      toast.success("Welcome to your Payout Portal.");
      onSigningIn();
      queryClient.clear();
      saveAuthAndRedirect(token, { ...userObj, role, merchantType }, "/payout-merchant/dashboard");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      {rateLimitSeconds !== null && (
        <RateLimitBanner
          retryAfterSeconds={rateLimitSeconds}
          message="Too many login attempts. Please wait before trying again."
          onDismiss={() => { setRateLimitSeconds(null); form.reset(); }}
        />
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
          <Button type="submit" className="w-full" disabled={isPending || rateLimitSeconds !== null}>
            {isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Form>
    </>
  );
}

// ---------- OTP tab ----------

const otpIdentifierSchema = z.object({
  identifier: z.string().min(3, "Enter your email or mobile number"),
});
type OtpIdentifierValues = z.infer<typeof otpIdentifierSchema>;

const otpCodeSchema = z.object({
  otp: z.string().length(6, "Enter the 6-digit code"),
});
type OtpCodeValues = z.infer<typeof otpCodeSchema>;

function OtpLoginTab({
  onRateLimited,
  onSigningIn,
}: {
  onRateLimited: (s: number) => void;
  onSigningIn: () => void;
}) {
  const [stage, setStage] = useState<"identifier" | "otp">("identifier");
  const [identifier, setIdentifier] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();

  const identifierForm = useForm<OtpIdentifierValues>({
    resolver: zodResolver(otpIdentifierSchema),
    defaultValues: { identifier: "" },
  });
  const otpForm = useForm<OtpCodeValues>({
    resolver: zodResolver(otpCodeSchema),
    defaultValues: { otp: "" },
  });

  const requestOtp = useRequestMerchantOtp();
  const verifyOtp = useVerifyMerchantOtp();

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startCooldown = () => {
    setResendIn(RESEND_COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const sendOtp = (data: OtpIdentifierValues) => {
    requestOtp.mutate(
      { data: { identifier: data.identifier } },
      {
        onSuccess: () => {
          setIdentifier(data.identifier);
          setStage("otp");
          otpForm.reset();
          startCooldown();
          toast.success("If an account matches that email or mobile number, a login code has been sent.");
        },
        onError: (err) => {
          const e = err as unknown as Record<string, unknown>;
          if ((e["status"] as number) === 429) {
            const headers = e["headers"] as Headers | undefined;
            onRateLimited(headers ? extractRateLimitSeconds(headers) : 60);
            return;
          }
          setIdentifier(data.identifier);
          setStage("otp");
          otpForm.reset();
          startCooldown();
          toast.success("If an account matches that email or mobile number, a login code has been sent.");
        },
      }
    );
  };

  const resend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      const base = (import.meta as any)?.env?.BASE_URL ?? "/";
      const apiBase = `${base}api`.replace(/\/+/g, "/").replace(/\/$/, "");
      const r = await fetch(`${apiBase}/auth/merchant/otp/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) {
        toast.error((data as any)?.error ?? "Maximum resend limit reached. Please start a new login.");
        return;
      }
      otpForm.reset();
      startCooldown();
      toast.success("A new code has been sent.");
    } catch {
      startCooldown();
      toast.success("A new code has been sent.");
    } finally {
      setResending(false);
    }
  };

  const onVerify = (data: OtpCodeValues) => {
    verifyOtp.mutate(
      { data: { identifier, otp: data.otp } },
      {
        onSuccess: (res) => {
          const userRecord = res.user as unknown as Record<string, unknown>;
          if (res.user.role !== UserRole.merchant) {
            toast.error("This account is not authorised for the Payout Merchant Portal.");
            return;
          }
          const merchantType = (userRecord["merchantType"] as string) || "";
          if (merchantType !== "PAYOUT_ONLY") {
            toast.error("This portal is for Payout merchants only. Please use the regular merchant login.");
            return;
          }
          toast.success("Welcome to your Payout Portal.");
          onSigningIn();
          queryClient.clear();
          saveAuthAndRedirect(res.token, userRecord, "/payout-merchant/dashboard");
        },
        onError: (err) => {
          const e = err as unknown as Record<string, unknown>;
          if ((e["status"] as number) === 429) {
            const headers = e["headers"] as Headers | undefined;
            onRateLimited(headers ? extractRateLimitSeconds(headers) : 60);
            return;
          }
          const data = e["data"] as Record<string, unknown> | null | undefined;
          const message = (data?.["error"] as string) || (e["message"] as string) || "Invalid or expired code.";
          toast.error(message);
          otpForm.setValue("otp", "");
        },
      }
    );
  };

  if (stage === "identifier") {
    return (
      <Form {...identifierForm}>
        <form onSubmit={identifierForm.handleSubmit(sendOtp)} className="space-y-6">
          <FormField
            control={identifierForm.control}
            name="identifier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email or mobile number</FormLabel>
                <FormControl>
                  <Input placeholder="you@company.com or +91 98765 43210" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={requestOtp.isPending}>
            {requestOtp.isPending ? "Sending code…" : "Send login code"}
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...otpForm}>
      <form onSubmit={otpForm.handleSubmit(onVerify)} className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code sent to <span className="font-medium text-foreground">{identifier}</span>. It expires in 5 minutes.
        </p>
        <FormField
          control={otpForm.control}
          name="otp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Verification code</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={verifyOtp.isPending}>
          {verifyOtp.isPending ? "Verifying…" : "Verify & sign in"}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setStage("identifier")}
          >
            Change email/mobile
          </button>
          <button
            type="button"
            className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
            disabled={resendIn > 0 || resending}
            onClick={resend}
          >
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </button>
        </div>
      </form>
    </Form>
  );
}

// ---------- Page ----------

export default function PayoutMerchantLogin() {
  const [tab, setTab] = useState<"password" | "otp">("password");
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);

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
            message="Too many attempts. Please wait before trying again."
            onDismiss={() => setRateLimitSeconds(null)}
          />
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "password" | "otp")} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="otp">OTP</TabsTrigger>
        </TabsList>

        <TabsContent value="password">
          <PasswordLoginTab
            onRateLimited={setRateLimitSeconds}
            onSigningIn={() => setSigningIn(true)}
          />
        </TabsContent>

        <TabsContent value="otp">
          <OtpLoginTab
            onRateLimited={setRateLimitSeconds}
            onSigningIn={() => setSigningIn(true)}
          />
        </TabsContent>
      </Tabs>

      <div className="text-center mt-6 text-sm text-muted-foreground space-y-2">
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
    </AuthLayout>
  );
}
