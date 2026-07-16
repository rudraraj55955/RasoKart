import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, CheckCircle2, ArrowLeft, ArrowRight, Building2, Shield, FileText, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Account", icon: Building2 },
  { id: 2, label: "Password", icon: Shield },
  { id: 3, label: "Business", icon: FileText },
  { id: 4, label: "Consent", icon: CreditCard },
];

const RESEND_COOLDOWN_SECONDS = 60;

function apiBase(): string {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api`.replace(/\/+/g, "/").replace(/\/$/, "");
}

const step1Schema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  contactName: z.string().min(2, "Contact name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(7, "Phone number is required").max(15, "Phone number too long").regex(/^\+?[0-9]+$/, "Invalid phone number"),
});

const step2Schema = z.object({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const step3Schema = z.object({
  businessType: z.enum(["Individual", "Partnership", "PrivateLimited", "LLP", "OPC", "HUF", "Other"], {
    required_error: "Please select a business type",
  }),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format (e.g. ABCDE1234F)"),
  address: z.string().min(10, "Please enter your full address (min 10 characters)").max(500),
});

const step4Schema = z.object({
  consentKyc: z.boolean().refine((v) => v, "KYC consent is required"),
  consentTerms: z.boolean().refine((v) => v, "Terms consent is required"),
});

const emailOtpSchema = z.object({
  otp: z.string().length(6, "Enter the 6-digit verification code"),
});

type Step1 = z.infer<typeof step1Schema>;
type Step2 = z.infer<typeof step2Schema>;
type Step3 = z.infer<typeof step3Schema>;
type Step4 = z.infer<typeof step4Schema>;
type EmailOtpValues = z.infer<typeof emailOtpSchema>;

interface AllData extends Step1, Omit<Step2, "confirmPassword">, Step3, Step4 {}

function PasswordInput({ field, disabled }: { field: any; disabled?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        autoComplete="new-password"
        placeholder="••••••••"
        disabled={disabled}
        className="pr-10"
        {...field}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function PayoutMerchantSignup() {
  const [step, setStep] = useState(1);
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [allData, setAllData] = useState<Partial<AllData>>({});
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const form1 = useForm<Step1>({ resolver: zodResolver(step1Schema), defaultValues: { businessName: "", contactName: "", email: "", phone: "" } });
  const form2 = useForm<Step2>({ resolver: zodResolver(step2Schema), defaultValues: { password: "", confirmPassword: "" } });
  const form3 = useForm<Step3>({
    resolver: zodResolver(step3Schema),
    defaultValues: { businessType: undefined, panNumber: "", address: "" },
  });
  const form4 = useForm<Step4>({ resolver: zodResolver(step4Schema), defaultValues: { consentKyc: false, consentTerms: false } });
  const otpForm = useForm<EmailOtpValues>({ resolver: zodResolver(emailOtpSchema), defaultValues: { otp: "" } });

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

  const sendEmailOtp = async (email: string): Promise<boolean> => {
    try {
      const r = await fetch(`${apiBase()}/auth/signup/send-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (r.status === 429) {
        toast.error("Too many requests. Please wait before trying again.");
        return false;
      }
      return true;
    } catch {
      toast.error("Network error. Please try again.");
      return false;
    }
  };

  const handleStep1 = form1.handleSubmit(async (data) => {
    setSendingOtp(true);
    try {
      const ok = await sendEmailOtp(data.email);
      if (!ok) return;
      setAllData((prev) => ({ ...prev, ...data }));
      otpForm.reset();
      setEmailVerifying(true);
      startCooldown();
      toast.success("A verification code has been sent to your email.");
    } finally {
      setSendingOtp(false);
    }
  });

  const handleEmailOtp = otpForm.handleSubmit(async (data) => {
    setIsPending(true);
    try {
      const email = (allData.email ?? "").trim().toLowerCase();
      const r = await fetch(`${apiBase()}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
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
      if (r.status === 400 && (body as any)?.error?.toLowerCase().includes("already registered")) {
        toast.error("This email is already registered. Please log in instead.");
        setEmailVerifying(false);
        setStep(1);
        return;
      }
      if (r.status === 429) {
        toast.error("Too many attempts. Please request a new code.");
        return;
      }
      setAllData((prev) => ({ ...prev, _emailOtp: data.otp } as any));
      setEmailVerifying(false);
      setStep(2);
    } finally {
      setIsPending(false);
    }
  });

  const handleResend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    try {
      const email = (allData.email ?? "").trim().toLowerCase();
      const r = await fetch(`${apiBase()}/auth/signup/send-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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

  const handleStep2 = form2.handleSubmit((data) => {
    setAllData((prev) => ({ ...prev, password: data.password }));
    setStep(3);
  });

  const handleStep3 = form3.handleSubmit((data) => {
    const upper = { ...data, panNumber: data.panNumber.toUpperCase() };
    setAllData((prev) => ({ ...prev, ...upper }));
    setStep(4);
  });

  const handleStep4 = form4.handleSubmit(async (data) => {
    const payload = { ...allData, ...data };
    if (!payload.email || !payload.password) return;
    setIsPending(true);
    try {
      const emailOtp = (payload as any)._emailOtp as string | undefined;
      const res = await fetch("/api/payout-merchant/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: payload.businessName,
          contactName: payload.contactName,
          email: payload.email.trim().toLowerCase(),
          phone: payload.phone,
          password: payload.password,
          businessType: payload.businessType,
          panNumber: payload.panNumber,
          address: payload.address,
          consentKyc: true,
          consentTerms: true,
          ...(emailOtp ? { emailOtp } : {}),
        }),
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as any).error ?? "An account already exists with these details.");
        setStep(1);
        return;
      }
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as any).error ?? "Validation error. Please check your details.");
        return;
      }
      if (res.status === 403) {
        toast.error("Self-registration is currently disabled. Please contact support.");
        return;
      }
      if (!res.ok) {
        toast.error("Registration failed. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsPending(false);
    }
  });

  if (submitted) {
    return (
      <AuthLayout title="Registration Submitted" subtitle="Your account has been created">
        <div className="flex flex-col items-center gap-6 py-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <div className="space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              Your payout merchant account has been registered. Log in and complete your KYC documents to activate payout access.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Payout access is enabled only after KYC verification and admin approval.
            </p>
          </div>
          <Link href="/payout-merchant/login" className="w-full">
            <Button className="w-full">Log in to your account</Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (emailVerifying) {
    const email = allData.email ?? "";
    return (
      <AuthLayout title="Payout Merchant Sign Up" subtitle="Verify your email address">
        <Form {...otpForm}>
          <form onSubmit={handleEmailOtp} className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to{" "}
              <span className="font-medium text-foreground">{email}</span>. It expires in 5 minutes.
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
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Verifying…" : "Verify email & continue"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setEmailVerifying(false)}
              >
                Change email
              </button>
              <button
                type="button"
                className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                disabled={resendIn > 0 || resending}
                onClick={handleResend}
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
    <AuthLayout
      title="Payout Merchant Sign Up"
      subtitle="Create your RasoKart Payout account"
    >
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-between">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = s.id === step;
          const done = s.id < step;
          return (
            <div key={s.id} className="flex flex-1 items-center">
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all",
                done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={cn("mx-1 hidden text-xs sm:block", active ? "text-foreground font-medium" : "text-muted-foreground")}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn("h-px flex-1", done ? "bg-emerald-500/60" : "bg-border/40")} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Account Info */}
      {step === 1 && (
        <Form {...form1}>
          <form onSubmit={handleStep1} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField control={form1.control} name="businessName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Business / Legal Name</FormLabel>
                  <FormControl><Input placeholder="Acme Payouts Pvt. Ltd." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form1.control} name="contactName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Person Name</FormLabel>
                  <FormControl><Input placeholder="Rahul Sharma" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form1.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl><Input type="email" autoComplete="email" placeholder="rahul@acme.in" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form1.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile Number</FormLabel>
                <FormControl><Input type="tel" placeholder="+91 9876543210" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full gap-2" disabled={sendingOtp}>
              {sendingOtp ? "Sending verification code…" : <><span>Continue</span> <ArrowRight className="h-4 w-4" /></>}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already registered?{" "}
              <Link href="/payout-merchant/login" className="text-primary hover:underline">Log in</Link>
            </p>
          </form>
        </Form>
      )}

      {/* Step 2: Password */}
      {step === 2 && (
        <Form {...form2}>
          <form onSubmit={handleStep2} className="space-y-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-green-400">
              <span>✓</span>
              <span>Email verified: <span className="font-medium">{allData.email}</span></span>
            </div>
            <FormField control={form2.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl><PasswordInput field={field} /></FormControl>
                <p className="text-xs text-muted-foreground">Min 8 characters, 1 uppercase, 1 number</p>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form2.control} name="confirmPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm Password</FormLabel>
                <FormControl><PasswordInput field={field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button type="submit" className="flex-1 gap-2">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </Form>
      )}

      {/* Step 3: Business Details */}
      {step === 3 && (
        <Form {...form3}>
          <form onSubmit={handleStep3} className="space-y-4">
            <FormField control={form3.control} name="businessType" render={({ field }) => (
              <FormItem>
                <FormLabel>Business Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select business type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {["Individual", "Partnership", "PrivateLimited", "LLP", "OPC", "HUF", "Other"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t === "PrivateLimited" ? "Private Limited (Pvt. Ltd.)" : t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form3.control} name="panNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>PAN Number</FormLabel>
                <FormControl>
                  <Input
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    className="uppercase"
                    {...field}
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form3.control} name="address" render={({ field }) => (
              <FormItem>
                <FormLabel>Registered Address</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Full registered address..."
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button type="submit" className="flex-1 gap-2">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </Form>
      )}

      {/* Step 4: Consent & Review */}
      {step === 4 && (
        <Form {...form4}>
          <form onSubmit={handleStep4} className="space-y-5">
            {/* Review summary */}
            <div className="rounded-xl border border-border/40 bg-card/40 p-4 text-sm space-y-2">
              <p className="font-medium text-foreground mb-1">Review your details</p>
              {[
                ["Business", allData.businessName],
                ["Contact", allData.contactName],
                ["Email", allData.email],
                ["Phone", allData.phone],
                ["Business Type", allData.businessType],
                ["PAN", allData.panNumber],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-foreground font-medium truncate max-w-[180px]">{value}</span>
                </div>
              ))}
            </div>

            <FormField control={form4.control} name="consentKyc" render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="mt-0.5"
                  />
                </FormControl>
                <div>
                  <FormLabel className="text-sm font-normal leading-snug cursor-pointer">
                    I agree to submit KYC documents (PAN, Aadhaar, bank details) after registration and consent to their verification by RasoKart.
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )} />

            <FormField control={form4.control} name="consentTerms" render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="mt-0.5"
                  />
                </FormControl>
                <div>
                  <FormLabel className="text-sm font-normal leading-snug cursor-pointer">
                    I agree to the{" "}
                    <span className="text-primary">Terms of Service</span>
                    {" "}and{" "}
                    <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
                    {" "}of RasoKart.
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )} />

            <p className="text-xs text-muted-foreground rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              Payout access is disabled until your KYC is verified and your account is approved by an admin. You can log in and start the KYC process immediately after registration.
            </p>

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => setStep(3)} disabled={isPending}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button type="submit" className="flex-1" disabled={isPending}>
                {isPending ? "Submitting..." : "Create Account"}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </AuthLayout>
  );
}
