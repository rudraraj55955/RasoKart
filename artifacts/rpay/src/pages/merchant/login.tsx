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
import { isRateLimitError } from "@/lib/utils";
import { useRateLimit, RateLimitBanner } from "@/components/ui/rate-limit-banner";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function MerchantLogin() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();
  const { isRateLimited, secondsLeft, trigger } = useRateLimit();

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
          if (isRateLimitError(err)) {
            trigger();
          } else {
            toast.error((err as { message?: string }).message || "Login failed");
          }
        },
      }
    );
  };

  return (
    <AuthLayout title="Merchant Portal" subtitle="Sign in to your RasoKart dashboard">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <RateLimitBanner secondsLeft={secondsLeft} message="Too many login attempts. Please wait before trying again." />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="you@company.com"
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
            disabled={loginMutation.isPending || isRateLimited}
          >
            {loginMutation.isPending
              ? "Authenticating..."
              : isRateLimited
                ? `Try again in ${secondsLeft}s`
                : "Sign in"}
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
