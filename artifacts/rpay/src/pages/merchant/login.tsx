import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useLogin,
  useRequestMerchantOtp,
  useVerifyMerchantOtp,
  useRequestMerchantPasswordReset,
  useResetMerchantPassword,
  UserRole,
} from "@workspace/api-client-react";
import { saveAuthAndRedirect } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RateLimitBanner } from "@/components/ui/rate-limit-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { SUPPORT_MAILTO } from "@/lib/support-config";

const ACCOUNT_SUSPENDED_MESSAGE = "Account suspended. Please contact support.";
const SAFE_OTP_MESSAGE = "If an account matches that email or mobile number, a login code has been sent.";
const RESEND_COOLDOWN_SECONDS = 60;

function getErrorInfo(err: unknown) {
  const e = err as unknown as Record<string, unknown>;
  const status = e["status"] as number | undefined;
  const data = e["data"] as Record<string, unknown> | null | undefined;
  const message = (data?.["error"] as string | undefined) || (e["message"] as string | undefined) || "Something went wrong.";
  return { status, message, headers: e["headers"] as Headers | undefined };
}

function extractRateLimitSeconds(headers?: Headers): number {
  const resetHeader = headers?.get("RateLimit-Reset") ?? headers?.get("ratelimit-reset");
  const seconds = resetHeader ? parseInt(resetHeader, 10) : 60;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

// ---------- Password tab ----------

const passwordLoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type PasswordLoginValues = z.infer<typeof passwordLoginSchema>;

function PasswordLoginTab({
  onRateLimited,
  onAccountSuspended,
  onSigningIn,
}: {
  onRateLimited: (seconds: number) => void;
  onAccountSuspended: (suspended: boolean) => void;
  onSigningIn: () => void;
}) {
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const form = useForm<PasswordLoginValues>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    form.reset();
  }, []);

  const loginMutation = useLogin();

  const onSubmit = (data: PasswordLoginValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          const userRecord = res.user as unknown as Record<string, unknown>;
          if (res.user.role !== UserRole.merchant) {
            toast.error("This account is not authorised for the Merchant Portal.");
            return;
          }
          const merchantType = (userRecord["merchantType"] as string) || "";
          const targetPath = merchantType === "PAYOUT_ONLY"
            ? "/payout-merchant/dashboard"
            : "/merchant/dashboard";
          toast.success("Welcome back.");
          onSigningIn();
          queryClient.clear();
          saveAuthAndRedirect(res.token, userRecord, targetPath);
        },
        onError: (err) => {
          const { status, message, headers } = getErrorInfo(err);
          if (status === 429) {
            const seconds = extractRateLimitSeconds(headers);
            setRateLimitSeconds(seconds);
            onRateLimited(seconds);
            return;
          }
          if (status === 401 && message === ACCOUNT_SUSPENDED_MESSAGE) {
            onAccountSuspended(true);
            return;
          }
          onAccountSuspended(false);
          toast.error(message || "Login failed");
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {rateLimitSeconds !== null && (
          <RateLimitBanner
            retryAfterSeconds={rateLimitSeconds}
            message="Too many login attempts. Please wait before trying again."
            onDismiss={() => { setRateLimitSeconds(null); form.reset(); }}
          />
        )}
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
                  placeholder="you@company.com"
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
        <Button type="submit" className="w-full" disabled={loginMutation.isPending || rateLimitSeconds !== null}>
          {loginMutation.isPending ? "Authenticating…" : "Sign in"}
        </Button>
      </form>
    </Form>
  );
}

// ---------- OTP login tab ----------

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
  onRateLimited: (seconds: number) => void;
  onSigningIn: () => void;
}) {
  const [stage, setStage] = useState<"identifier" | "otp">("identifier");
  const [identifier, setIdentifier] = useState("");
  const [resendIn, setResendIn] = useState(0);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setResendIn(RESEND_COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
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
          toast.success(SAFE_OTP_MESSAGE);
        },
        onError: (err) => {
          const { status, headers } = getErrorInfo(err);
          if (status === 429) {
            onRateLimited(extractRateLimitSeconds(headers));
            return;
          }
          setIdentifier(data.identifier);
          setStage("otp");
          startCooldown();
          toast.success(SAFE_OTP_MESSAGE);
        },
      }
    );
  };

  const [resending, setResending] = useState(false);
  const resend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      const BASE = (import.meta as any)?.env?.BASE_URL ?? "/";
      const apiBase = `${BASE}api`.replace(/\/+/g, "/").replace(/\/$/, "");
      const r = await fetch(`${apiBase}/auth/merchant/otp/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await r.json().catch(() => ({ message: "" }));
      if (r.status === 429) {
        toast.error(data?.error ?? "Maximum resend limit reached. Please start a new login.");
        return;
      }
      otpForm.reset();
      startCooldown();
      toast.success(data?.message ?? "A new code has been sent.");
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
            toast.error("This account is not authorised for the Merchant Portal.");
            return;
          }
          const merchantType = (userRecord["merchantType"] as string) || "";
          const targetPath = merchantType === "PAYOUT_ONLY"
            ? "/payout-merchant/dashboard"
            : "/merchant/dashboard";
          toast.success("Welcome back.");
          onSigningIn();
          queryClient.clear();
          saveAuthAndRedirect(res.token, userRecord, targetPath);
        },
        onError: (err) => {
          const { status, message, headers } = getErrorInfo(err);
          if (status === 429) {
            onRateLimited(extractRateLimitSeconds(headers));
            return;
          }
          toast.error(message || "Invalid or expired code.");
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
            onClick={() => { setStage("identifier"); }}
          >
            Change email/mobile
          </button>
          <button
            type="button"
            className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
            disabled={resendIn > 0 || requestOtp.isPending}
            onClick={resend}
          >
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </button>
        </div>
      </form>
    </Form>
  );
}

// ---------- Forgot password tab ----------

const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const forgotOtpSchema = z.object({
  otp: z.string().length(6, "Enter the 6-digit code"),
  newPassword: newPasswordSchema,
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type ForgotOtpValues = z.infer<typeof forgotOtpSchema>;

function ForgotPasswordTab({
  onRateLimited,
  onDone,
}: {
  onRateLimited: (seconds: number) => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<"identifier" | "reset">("identifier");
  const [identifier, setIdentifier] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const identifierForm = useForm<OtpIdentifierValues>({
    resolver: zodResolver(otpIdentifierSchema),
    defaultValues: { identifier: "" },
  });
  const resetForm = useForm<ForgotOtpValues>({
    resolver: zodResolver(forgotOtpSchema),
    defaultValues: { otp: "", newPassword: "", confirmPassword: "" },
  });

  const requestReset = useRequestMerchantPasswordReset();
  const resetPassword = useResetMerchantPassword();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setResendIn(RESEND_COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = (data: OtpIdentifierValues) => {
    requestReset.mutate(
      { data: { identifier: data.identifier } },
      {
        onSuccess: () => {
          setIdentifier(data.identifier);
          setStage("reset");
          resetForm.reset();
          startCooldown();
          toast.success(SAFE_OTP_MESSAGE);
        },
        onError: (err) => {
          const { status, headers } = getErrorInfo(err);
          if (status === 429) {
            onRateLimited(extractRateLimitSeconds(headers));
            return;
          }
          setIdentifier(data.identifier);
          setStage("reset");
          startCooldown();
          toast.success(SAFE_OTP_MESSAGE);
        },
      }
    );
  };

  const resend = () => {
    if (resendIn > 0) return;
    requestReset.mutate(
      { data: { identifier } },
      {
        onSuccess: () => {
          resetForm.reset();
          startCooldown();
          toast.success("A new code has been sent.");
        },
        onError: (err) => {
          const { status, headers } = getErrorInfo(err);
          if (status === 429) {
            onRateLimited(extractRateLimitSeconds(headers));
            return;
          }
          startCooldown();
          toast.success("A new code has been sent.");
        },
      }
    );
  };

  const onSubmitReset = (data: ForgotOtpValues) => {
    resetPassword.mutate(
      { data: { identifier, otp: data.otp, newPassword: data.newPassword } },
      {
        onSuccess: () => {
          toast.success("Password reset. You can now sign in with your new password.");
          onDone();
        },
        onError: (err) => {
          const { status, message, headers } = getErrorInfo(err);
          if (status === 429) {
            onRateLimited(extractRateLimitSeconds(headers));
            return;
          }
          toast.error(message || "Could not reset password.");
        },
      }
    );
  };

  if (stage === "identifier") {
    return (
      <Form {...identifierForm}>
        <form onSubmit={identifierForm.handleSubmit(sendCode)} className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Enter the email or mobile number on your account and we'll send you a reset code.
          </p>
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
          <Button type="submit" className="w-full" disabled={requestReset.isPending}>
            {requestReset.isPending ? "Sending code…" : "Send reset code"}
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...resetForm}>
      <form onSubmit={resetForm.handleSubmit(onSubmitReset)} className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code sent to <span className="font-medium text-foreground">{identifier}</span> and choose a new password.
        </p>
        <FormField
          control={resetForm.control}
          name="otp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Verification code</FormLabel>
              <FormControl>
                <Input inputMode="numeric" maxLength={6} placeholder="123456" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={resetForm.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={resetForm.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? "Resetting…" : "Reset password"}
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
            disabled={resendIn > 0 || requestReset.isPending}
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

export default function MerchantLogin() {
  const [tab, setTab] = useState<"password" | "otp" | "forgot">("password");
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [accountSuspended, setAccountSuspended] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  if (signingIn) {
    return (
      <AuthLayout title="Merchant Portal" subtitle="Sign in to your RasoKart dashboard">
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm">Signing you in…</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Merchant Portal" subtitle="Sign in to your RasoKart dashboard">
      {accountSuspended && (
        <div className="mb-6">
          <Alert className="border-red-500/50 bg-red-500/10 text-red-400 [&>svg]:text-red-400">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="pl-1">
              <span className="font-medium">Your account has been suspended.</span>{" "}
              <span className="text-red-300/80">Please </span>
              <a
                href={SUPPORT_MAILTO}
                className="text-red-300 underline underline-offset-2 hover:text-red-200 transition-colors"
              >
                contact support
              </a>
              <span className="text-red-300/80"> to restore access.</span>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {rateLimitSeconds !== null && (
        <div className="mb-6">
          <RateLimitBanner
            retryAfterSeconds={rateLimitSeconds}
            message="Too many attempts. Please wait before trying again."
            onDismiss={() => setRateLimitSeconds(null)}
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "password" | "otp" | "forgot")} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="otp">OTP</TabsTrigger>
          <TabsTrigger value="forgot">Forgot</TabsTrigger>
        </TabsList>

        <TabsContent value="password">
          <PasswordLoginTab
            onRateLimited={setRateLimitSeconds}
            onAccountSuspended={setAccountSuspended}
            onSigningIn={() => setSigningIn(true)}
          />
        </TabsContent>

        <TabsContent value="otp">
          <OtpLoginTab
            onRateLimited={setRateLimitSeconds}
            onSigningIn={() => setSigningIn(true)}
          />
        </TabsContent>

        <TabsContent value="forgot">
          <ForgotPasswordTab
            onRateLimited={setRateLimitSeconds}
            onDone={() => setTab("password")}
          />
        </TabsContent>
      </Tabs>

      <div className="text-center mt-6 text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link href="/merchant/apply" className="text-primary hover:underline">
          Apply for an account
        </Link>
      </div>
    </AuthLayout>
  );
}
