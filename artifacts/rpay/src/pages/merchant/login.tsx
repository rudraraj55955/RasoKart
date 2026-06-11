import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, UserRole } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RateLimitBanner } from "@/components/ui/rate-limit-banner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";

const ACCOUNT_SUSPENDED_MESSAGE = "Account suspended. Please contact support.";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function MerchantLogin() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [accountSuspended, setAccountSuspended] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.user.role !== UserRole.merchant) {
            toast.error("Unauthorized. Merchant access required.");
            return;
          }
          setAuthToken(res.token);
          toast.success("Welcome back.");
          setLocation("/merchant/dashboard");
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
          if (e["status"] === 401 && (e["data"] as Record<string, unknown> | null)?.["error"] === ACCOUNT_SUSPENDED_MESSAGE) {
            setAccountSuspended(true);
            return;
          }
          setAccountSuspended(false);
          toast.error(e["message"] as string || "Login failed");
        },
      }
    );
  };

  return (
    <AuthLayout title="Merchant Portal" subtitle="Sign in to your RasoKart dashboard">
      {accountSuspended && (
        <div className="mb-6">
          <Alert className="border-red-500/50 bg-red-500/10 text-red-400 [&>svg]:text-red-400">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="pl-1">
              <span className="font-medium">Your account has been suspended.</span>{" "}
              <span className="text-red-300/80">Please contact support to restore access.</span>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {rateLimitSeconds !== null && (
        <div className="mb-6">
          <RateLimitBanner
            retryAfterSeconds={rateLimitSeconds}
            message="Too many login attempts. Please wait before trying again."
            onDismiss={() => setRateLimitSeconds(null)}
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
                  <Input placeholder="you@company.com" disabled={rateLimitSeconds !== null} {...field} />
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

          <div className="text-center mt-4 text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/merchant/apply" className="text-primary hover:underline">
              Apply for an account
            </Link>
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
