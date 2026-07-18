import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth-context";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function apiBase(): string {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api`.replace(/\/+/g, "/").replace(/\/$/, "");
}

const RESEND_COOLDOWN_SECONDS = 60;

// ---------- Step 0: verify email ----------

const emailVerifySchema = z.object({
  email: z.string().email("Invalid email address"),
});
type EmailVerifyValues = z.infer<typeof emailVerifySchema>;

const otpVerifySchema = z.object({
  otp: z.string().length(6, "Enter the 6-digit verification code"),
});
type OtpVerifyValues = z.infer<typeof otpVerifySchema>;

// ---------- Step 1: main registration form ----------

const registerSchema = z.object({
  businessName: z.string().min(2, "Business name is required"),
  contactName: z.string().min(2, "Contact name is required"),
  phone: z.string().min(5, "Phone number is required"),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
type RegisterFormValues = z.infer<typeof registerSchema>;

export default function MerchantRegister() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();

  const [stage, setStage] = useState<"email" | "otp" | "registration">("email");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [verifiedOtp, setVerifiedOtp] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const emailForm = useForm<EmailVerifyValues>({
    resolver: zodResolver(emailVerifySchema),
    defaultValues: { email: "" },
  });
  const otpForm = useForm<OtpVerifyValues>({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { otp: "" },
  });
  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { businessName: "", contactName: "", phone: "", website: "", password: "" },
  });

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

  const sendOtp = async (data: EmailVerifyValues) => {
    setSending(true);
    try {
      const r = await fetch(`${apiBase()}/auth/signup/send-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email.trim().toLowerCase() }),
      });
      if (r.status === 429) {
        toast.error("Too many requests. Please wait before trying again.");
        return;
      }
      setVerifiedEmail(data.email.trim().toLowerCase());
      setStage("otp");
      otpForm.reset();
      startCooldown();
      toast.success("A verification code has been sent to your email.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const resendOtp = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      const r = await fetch(`${apiBase()}/auth/signup/send-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifiedEmail }),
      });
      if (r.status === 429) {
        toast.error("Too many requests. Please wait.");
        return;
      }
      otpForm.setValue("otp", "");
      startCooldown();
      toast.success("A new code has been sent.");
    } catch {
      startCooldown();
    } finally {
      setResending(false);
    }
  };

  const verifyOtp = async (data: OtpVerifyValues) => {
    setVerifying(true);
    try {
      const r = await fetch(`${apiBase()}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifiedEmail,
          emailOtp: data.otp,
          password: "__probe__",
          businessName: "__probe__",
          contactName: "__probe__",
          phone: "__probe__",
        }),
      });
      const body = await r.json().catch(() => ({}));

      if (r.status === 400 && (body as any)?.error?.toLowerCase().includes("verification code")) {
        toast.error((body as any).error);
        otpForm.setValue("otp", "");
        return;
      }

      if (r.status === 429) {
        toast.error("Too many attempts. Please request a new code.");
        return;
      }

      setVerifiedOtp(data.otp);
      setStage("registration");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const onSubmit = async (data: RegisterFormValues) => {
    setSubmitting(true);
    try {
      const r = await fetch(`${apiBase()}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifiedEmail,
          emailOtp: verifiedOtp,
          password: data.password,
          businessName: data.businessName,
          contactName: data.contactName,
          phone: data.phone,
          website: data.website || null,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (body as any)?.error ?? "Registration failed. Please try again.";
        if (msg.toLowerCase().includes("verification") || msg.toLowerCase().includes("otp")) {
          toast.error("Your verification code has expired. Please start over.");
          setStage("email");
          setVerifiedOtp("");
          emailForm.setValue("email", verifiedEmail);
        } else {
          toast.error(msg);
        }
        return;
      }
      const res = body as { token: string };
      setAuthToken(res.token);
      toast.success("Application submitted successfully.");
      setLocation("/merchant/dashboard");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "email") {
    return (
      <AuthLayout title="Apply for RasoKart" subtitle="Verify your email to get started">
        <Form {...emailForm}>
          <form onSubmit={emailForm.handleSubmit(sendOtp)} className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Enter your business email address. We'll send a verification code before you create your account.
            </p>
            <FormField
              control={emailForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="jane@company.com" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? "Sending code…" : "Send verification code"}
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/merchant" className="text-primary hover:underline">
                Sign in
              </Link>
            </div>
          </form>
        </Form>
      </AuthLayout>
    );
  }

  if (stage === "otp") {
    return (
      <AuthLayout title="Apply for RasoKart" subtitle="Verify your email">
        <Form {...otpForm}>
          <form onSubmit={otpForm.handleSubmit(verifyOtp)} className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to{" "}
              <span className="font-medium text-foreground">{verifiedEmail}</span>. It expires in 5 minutes.
            </p>
            <FormField
              control={otpForm.control}
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
            <Button type="submit" className="w-full" disabled={verifying}>
              {verifying ? "Verifying…" : "Verify email"}
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
                onClick={resendOtp}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </form>
        </Form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Apply for RasoKart" subtitle="Create your merchant account">
      <div className="mb-4 flex items-center gap-2 text-xs text-green-400">
        <span>✓</span>
        <span>Email verified: <span className="font-medium">{verifiedEmail}</span></span>
      </div>
      <Form {...registerForm}>
        <form onSubmit={registerForm.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={registerForm.control}
              name="businessName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Inc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={registerForm.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={registerForm.control}
              name="contactName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={registerForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="+91 98765 43210" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={registerForm.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full mt-2" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit Application"}
          </Button>

          <div className="text-center mt-4 text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/merchant" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>

          <div className="flex items-start gap-2.5 mt-3 px-1">
            <input
              type="checkbox"
              id="termsCheck"
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
            />
            <label htmlFor="termsCheck" className="text-xs text-muted-foreground/70 leading-relaxed cursor-pointer">
              I have read and agree to the{" "}
              <Link href="/terms-and-conditions" className="text-primary hover:underline underline-offset-2" target="_blank">
                Terms & Conditions
              </Link>
              ,{" "}
              <Link href="/merchant-agreement" className="text-primary hover:underline underline-offset-2" target="_blank">
                Merchant Agreement
              </Link>
              , and{" "}
              <Link href="/privacy-policy" className="text-primary hover:underline underline-offset-2" target="_blank">
                Privacy Policy
              </Link>
              .
            </label>
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
