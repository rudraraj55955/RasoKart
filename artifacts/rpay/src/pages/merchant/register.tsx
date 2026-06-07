import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRegisterMerchant, UserRole } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  businessName: z.string().min(2, "Business name is required"),
  contactName: z.string().min(2, "Contact name is required"),
  phone: z.string().min(5, "Phone number is required"),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function MerchantRegister() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();
  
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      businessName: "",
      contactName: "",
      phone: "",
      website: "",
    },
  });

  const registerMutation = useRegisterMerchant();

  const onSubmit = (data: RegisterFormValues) => {
    registerMutation.mutate(
      { data: {
          ...data,
          website: data.website || null
        } 
      },
      {
        onSuccess: (res) => {
          setAuthToken(res.token);
          toast.success("Application submitted successfully.");
          setLocation("/merchant/dashboard");
        },
        onError: (err) => {
          toast.error(err.message || "Registration failed");
        },
      }
    );
  };

  return (
    <AuthLayout title="Apply for RPay" subtitle="Create your merchant account">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
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
              control={form.control}
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
              control={form.control}
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
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="+1 555 123 4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Work Email</FormLabel>
                <FormControl>
                  <Input placeholder="jane@company.com" {...field} />
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
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <Button 
            type="submit" 
            className="w-full mt-2" 
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? "Submitting..." : "Submit Application"}
          </Button>
          
          <div className="text-center mt-4 text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/merchant/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
