import { useListMerchantProducts, useToggleMerchantProduct, getListMerchantProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { QrCode, Zap, Building2, Link, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

const PRODUCT_META: Record<string, { label: string; description: string; icon: React.ReactNode; category: string }> = {
  dynamic_qr: { label: "Dynamic QR", description: "Generate dynamic QR codes with variable amounts for each transaction.", icon: <Zap className="w-6 h-6 text-yellow-400" />, category: "Deposit" },
  static_qr: { label: "Static QR", description: "Fixed QR codes for recurring payments and storefronts.", icon: <QrCode className="w-6 h-6 text-blue-400" />, category: "Deposit" },
  virtual_account: { label: "Virtual Account", description: "Dedicated bank account numbers for seamless collections.", icon: <Building2 className="w-6 h-6 text-purple-400" />, category: "Deposit" },
  payment_links: { label: "Payment Links", description: "Share payment links via SMS, email, or WhatsApp.", icon: <Link className="w-6 h-6 text-emerald-400" />, category: "Deposit" },
  payouts: { label: "Payouts", description: "Disburse funds instantly via IMPS, NEFT, RTGS.", icon: <ArrowUpRight className="w-6 h-6 text-rose-400" />, category: "Payout" },
};

export default function MerchantProducts() {
  const qc = useQueryClient();
  const { data, isLoading } = useListMerchantProducts();
  const toggleMutation = useToggleMerchantProduct();

  const handleToggle = (productType: string, enabled: boolean) => {
    toggleMutation.mutate({ productType, data: { enabled } }, {
      onSuccess: () => {
        toast.success(`${PRODUCT_META[productType]?.label} ${enabled ? "enabled" : "disabled"}`);
        qc.invalidateQueries({ queryKey: getListMerchantProductsQueryKey() });
      },
      onError: () => toast.error("Failed to update product"),
    });
  };

  const depositProducts = data?.filter(p => PRODUCT_META[p.productType]?.category === "Deposit") ?? [];
  const payoutProducts = data?.filter(p => PRODUCT_META[p.productType]?.category === "Payout") ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Products Marketplace</h1>
        <p className="text-muted-foreground mt-1">Enable or disable payment products for your merchant account.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5].map(i => <Card key={i} className="animate-pulse h-40 bg-muted/50" />)}
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Deposit Products</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {depositProducts.map(product => {
                const meta = PRODUCT_META[product.productType];
                return (
                  <Card key={product.productType} className={`transition-all border ${product.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-card border border-border/60 flex items-center justify-center">
                            {meta?.icon}
                          </div>
                          <div>
                            <CardTitle className="text-base">{meta?.label}</CardTitle>
                            <Badge variant={product.enabled ? "default" : "secondary"} className="text-[10px] mt-0.5">
                              {product.enabled ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                        </div>
                        <Switch
                          checked={product.enabled}
                          onCheckedChange={checked => handleToggle(product.productType, checked)}
                          disabled={toggleMutation.isPending}
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{meta?.description}</CardDescription>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Payout Products</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {payoutProducts.map(product => {
                const meta = PRODUCT_META[product.productType];
                return (
                  <Card key={product.productType} className={`transition-all border ${product.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-card border border-border/60 flex items-center justify-center">
                            {meta?.icon}
                          </div>
                          <div>
                            <CardTitle className="text-base">{meta?.label}</CardTitle>
                            <Badge variant={product.enabled ? "default" : "secondary"} className="text-[10px] mt-0.5">
                              {product.enabled ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                        </div>
                        <Switch
                          checked={product.enabled}
                          onCheckedChange={checked => handleToggle(product.productType, checked)}
                          disabled={toggleMutation.isPending}
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{meta?.description}</CardDescription>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
