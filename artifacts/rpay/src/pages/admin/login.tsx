import { useState, useEffect, useRef } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Eye, EyeOff } from "lucide-react";

const RESEND_COOLDOWN_SECONDS = 60;

function apiUrl(path: string): string {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api${path}`.replace(/\/+/g, "/");
}

function extractRateLimitSeconds(headers: Headers): number {
  const h = headers.get("RateLimit-Reset") ?? headers.get("ratelimit-reset");
  const s = h ? parseInt(h, 10) : 60;
  return Number.isFinite(s) && s > 0 ? s : 60;
}

// ---------- Password tab ----------

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

function PasswordLoginTab({
  onRateLimited,
  onSigningIn,
}: {
  onRateLimited: (s: number) => void;
  onSigningIn: () => void;
}) {
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => { form.reset(); }, []);

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
          onSigningIn();
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
            const seconds = headers ? extractRateLimitSeconds(headers) : 60;
            setRateLimitSeconds(seconds);
            onRateLimited(seconds);
            return;
          }
          toast.error((e["message"] as string) || "Login failed");
        },
      }
    );
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
    </>
  );
}

// ---------- OTP tab ----------

const otpEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
});
type OtpEmailValues = z.infer<typeof otpEmailSchema>;

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
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();

  const emailForm = useForm<OtpEmailValues>({
    resolver: zodResolver(otpEmailSchema),
    defaultValues: { email: "" },
  });
  const codeForm = useForm<OtpCodeValues>({
    resolver: zodResolver(otpCodeSchema),
    defaultValues: { otp: "" },
  });

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

  const sendCode = async (data: OtpEmailValues) => {
    setSending(true);
    try {
      const r = await fetch(apiUrl("/auth/admin/otp/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      if (r.status === 429) {
        onRateLimited(extractRateLimitSeconds(r.headers));
        return;
      }
      setEmail(data.email);
      setStage("code");
      codeForm.reset();
      startCooldown();
      toast.success("If this admin account exists, a login code has been sent.");
    } catch {
      setEmail(data.email);
      setStage("code");
      startCooldown();
      toast.success("If this admin account exists, a login code has been sent.");
    } finally {
      setSending(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      const r = await fetch(apiUrl("/auth/admin/otp/resend"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) {
        toast.error((data as any)?.error ?? "Maximum resend limit reached. Please start a new login.");
        return;
      }
      codeForm.reset();
      startCooldown();
      toast.success("A new code has been sent.");
    } catch {
      startCooldown();
      toast.success("A new code has been sent.");
    } finally {
      setResending(false);
    }
  };

  const verifyCode = async (data: OtpCodeValues) => {
    setVerifying(true);
    try {
      const r = await fetch(apiUrl("/auth/admin/otp/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: data.otp }),
      });
      if (r.status === 429) {
        onRateLimited(extractRateLimitSeconds(r.headers));
        return;
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast.error((body as any)?.error ?? "Invalid or expired code.");
        codeForm.setValue("otp", "");
        return;
      }
      const body = await r.json() as Record<string, unknown>;
      const userObj = (body["user"] as Record<string, unknown>) ?? {};
      const token = typeof body["token"] === "string" ? body["token"] : "";
      if (!token) { toast.error("Login failed. Please try again."); return; }
      if (userObj["role"] !== "admin") {
        toast.error("This account is not authorised for the Admin Portal.");
        return;
      }
      onSigningIn();
      queryClient.clear();
      saveAuthAndRedirect(token, userObj, "/admin/dashboard");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  if (stage === "email") {
    return (
      <Form {...emailForm}>
        <form onSubmit={emailForm.handleSubmit(sendCode)} className="space-y-6">
          <FormField
            control={emailForm.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Admin email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" placeholder="admin@rasokart.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? "Sending code…" : "Send login code"}
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...codeForm}>
      <form onSubmit={codeForm.handleSubmit(verifyCode)} className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code sent to <span className="font-medium text-foreground">{email}</span>. It expires in 5 minutes.
        </p>
        <FormField
          control={codeForm.control}
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
        <Button type="submit" className="w-full" disabled={verifying}>
          {verifying ? "Verifying…" : "Verify & sign in"}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setStage("email")}
          >
            Change email
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

export default function AdminLogin() {
  const [tab, setTab] = useState<"password" | "otp">("password");
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);

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
    </AuthLayout>
  );
}
