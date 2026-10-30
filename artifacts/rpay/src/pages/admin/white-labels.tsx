import { useEffect, useState } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type Tenant = { id: number; slug: string; displayName: string; status: string; createdAt: string };

export default function AdminWhiteLabels() {
  const { data: me, isLoading: authLoading } = useGetMe();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const allowed = me?.isSuperAdmin === true;
  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/white-labels", { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Unable to load companies (${res.status})`);
      const json = await res.json();
      setTenants(json.data ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load companies"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (allowed) void load(); }, [allowed]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowed || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/white-labels", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug.trim(), displayName: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to create company");
      toast.success("Draft company created. Payments and domains remain disabled.");
      setName(""); setSlug("");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to create company"); }
    finally { setSaving(false); }
  };
  if (authLoading) return <p className="p-6">Checking permissions...</p>;
  if (!allowed) return <div className="p-6" role="alert">Only the RasoKart Platform Super Admin can manage white labels.</div>;
  return <div className="space-y-6 p-4 md:p-6">
    <div><h1 className="text-2xl font-bold">White-Label Companies</h1><p className="text-muted-foreground">Platform Super Admin · Draft onboarding only</p></div>
    <Card><CardHeader><CardTitle>Create Draft Company</CardTitle></CardHeader>
      <CardContent><form onSubmit={create} className="grid gap-3 md:grid-cols-3">
        <Input aria-label="Company name" placeholder="Company name" maxLength={120} required value={name} onChange={e=>setName(e.target.value)}/>
        <Input aria-label="Company slug" placeholder="company-slug" pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" maxLength={48} required value={slug} onChange={e=>setSlug(e.target.value)}/>
        <Button disabled={saving} type="submit">{saving ? "Creating..." : "Create Draft"}</Button>
      </form><p className="mt-2 text-xs text-muted-foreground">Creating a draft does not activate payments, domain routing, or provider connections.</p></CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Companies ({tenants.length})</CardTitle></CardHeader><CardContent>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {loading ? <p>Loading...</p> : tenants.length === 0 ? <p className="text-muted-foreground">No companies yet.</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Company</th><th className="p-2">Slug</th><th className="p-2">Status</th></tr></thead><tbody>
        {tenants.map(t=><tr className="border-b" key={t.id}><td className="p-2">{t.displayName}</td><td className="p-2">{t.slug}</td><td className="p-2">{t.status}</td></tr>)}
      </tbody></table></div>}
    </CardContent></Card>
  </div>;
}
