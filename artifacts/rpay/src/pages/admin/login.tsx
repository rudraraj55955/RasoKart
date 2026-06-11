import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, UserRole } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isRateLimitError } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loginMutation = useLogin();

  const clearRateLimitError = () => {
    if (rateLimitError) setRateLimitError(null);
  };

  const onSubmit = (data: LoginFormValues) => {
    setRateLimitError(null);
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.user.role !== UserRole.admin) {
            toast.error("Unauthorized. Admin access required.");
            return;
          }
          setAuthToken(res.token);
          toast.success("Welcome back, Admin.");
          setLocation("/admin/dashboard");
        },
        onError: (err) => {
          if (isRateLimitError(err)) {
            setRateLimitError("Too many login attempts. Please wait before trying again.");
          } else {
            toast.error((err as { message?: string }).message || "Login failed");
          }
        },
      }
    );
  };

  return (
    <AuthLayout title="Admin Portal" subtitle="Sign in to RasoKart operations">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {rateLimitError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{rateLimitError}</span>
            </div>
          )}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="admin@rasokart.com"
                    {...field}
                    onChange={(e) => { field.onChange(e); clearRateLimitError(); }}
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
                    onChange={(e) => { field.onChange(e); clearRateLimitError(); }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending || !!rateLimitError}
          >
            {loginMutation.isPending ? "Authenticating..." : "Sign in"}
          </Button>
        </form>
      </Form>
    </AuthLayout>
  );
}
