import { useEffect, useState } from "react";
import { useGetWebhookConfig, useUpdateWebhookConfig, getGetWebhookConfigQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Save, Webhook } from "lucide-react";

const EVENTS = [
  { id: "payment.success", label: "Payment Success" },
  { id: "payment.failed", label: "Payment Failed" },
  { id: "payment.pending", label: "Payment Pending" },
  { id: "withdrawal.approved", label: "Withdrawal Approved" },
  { id: "withdrawal.rejected", label: "Withdrawal Rejected" },
  { id: "settlement.processed", label: "Settlement Processed" },
];

export default function MerchantWebhook() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetWebhookConfig();
  const updateMutation = useUpdateWebhookConfig();

  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (config) {
      setUrl(config.url || "");
      setSecret(config.secret || "");
      setIsActive(config.isActive);
      setEvents(config.events || []);
    }
  }, [config]);

  const toggleEvent = (eventId: string) => {
    setEvents(prev => prev.includes(eventId) ? prev.filter(e => e !== eventId) : [...prev, eventId]);
  };

  const handleSave = () => {
    if (!url.trim()) { toast.error("Webhook URL is required"); return; }
    updateMutation.mutate({ data: { url: url.trim(), isActive, events, secret: secret || null } }, {
      onSuccess: () => { toast.success("Webhook configuration saved"); qc.invalidateQueries({ queryKey: getGetWebhookConfigQueryKey() }); },
      onError: () => toast.error("Failed to save configuration"),
    });
  };

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />)}</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20"><Webhook className="w-5 h-5 text-primary" /></div>
        <div><h1 className="text-3xl font-bold tracking-tight">Webhook</h1><p className="text-muted-foreground mt-0.5">Configure callback URL for payment events</p></div>
      </div>

      <Card>
        <CardHeader><CardTitle>Endpoint Configuration</CardTitle><CardDescription>RasoKart will send POST requests to this URL for the selected events</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label>Webhook URL</Label>
            <Input className="mt-1.5 font-mono" placeholder="https://yourapp.com/webhook" value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <div>
            <Label>Signing Secret <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input className="mt-1.5 font-mono" type="password" placeholder="Used to verify payload authenticity" value={secret} onChange={e => setSecret(e.target.value)} />
          </div>
          <div className="flex items-center justify-between py-3 border-t border-border/50">
            <div>
              <p className="font-medium text-sm">Active</p>
              <p className="text-xs text-muted-foreground">Enable or disable webhook delivery</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Events</CardTitle><CardDescription>Select which events trigger your webhook</CardDescription></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {EVENTS.map(event => (
              <div key={event.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => toggleEvent(event.id)}>
                <Checkbox id={event.id} checked={events.includes(event.id)} onCheckedChange={() => toggleEvent(event.id)} />
                <div className="flex-1">
                  <label htmlFor={event.id} className="text-sm font-medium cursor-pointer">{event.label}</label>
                  <p className="text-xs text-muted-foreground font-mono">{event.id}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMutation.isPending} className="w-full sm:w-auto">
        <Save className="w-4 h-4 mr-2" />
        {updateMutation.isPending ? "Saving..." : "Save Configuration"}
      </Button>
    </div>
  );
}
