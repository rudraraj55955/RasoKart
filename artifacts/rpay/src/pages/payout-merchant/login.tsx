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

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export default function PayoutMerchantLogin() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          const role = res.user.role as string;
          const merchantType = (res.user as any).merchantType as string | undefined;
          if (role !== UserRole.payout_merchant && role !== UserRole.merchant) {
            toast.error("Unauthorized. Payout Merchant access required.");
            return;
          }
          // Block NORMAL pay-in merchants — only PAYOUT_ONLY or BOTH allowed here
          if (role === UserRole.merchant && merchantType !== "PAYOUT_ONLY" && merchantType !== "BOTH") {
            toast.error("This portal is for Payout merchants only. Please use the regular merchant login.");
            return;
          }
          setAuthToken(res.token);
          toast.success("Welcome to your Payout Portal.");
          setLocation("/payout-merchant/dashboard");
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
          toast.error(e["message"] as string || "Login failed");
        },
      }
    );
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
            disabled={loginMutation.isPending || rateLimitSeconds !== null}
          >
            {loginMutation.isPending ? "Authenticating..." : "Sign in"}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            <Link href="/" className="text-primary hover:underline">← Back to RasoKart</Link>
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
