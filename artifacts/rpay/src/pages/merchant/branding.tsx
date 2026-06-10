import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useUpdateMerchantBranding } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Palette, ImageIcon, Save, Eye, RotateCcw, CheckCircle2, TriangleAlert, Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PRESET_COLORS = [
  { label: "Indigo", value: "#6366f1" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Sky", value: "#0ea5e9" },
  { label: "Emerald", value: "#10b981" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Orange", value: "#f97316" },
  { label: "Teal", value: "#14b8a6" },
];

function isValidHex(v: string) {
  return /^#[0-9a-f]{3,8}$/i.test(v);
}

export default function MerchantBranding() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const merchantId = (user as any)?.merchantId as number | undefined;

  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [logoError, setLogoError] = useState(false);
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(null);
  const [savedLogoError, setSavedLogoError] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const { uploadFile, isUploading } = useUpload({
    basePath: `${base}/api/storage`,
    requestHeaders: {
      Authorization: `Bearer ${localStorage.getItem("rasokart_token") ?? ""}`,
    },
    onSuccess: (response) => {
      const servedUrl = `${base}/api/storage${response.objectPath}`;
      setLogoUrl(servedUrl);
      setLogoError(false);
      toast.success("Logo uploaded");
    },
    onError: () => toast.error("Logo upload failed"),
  });

  const updateBranding = useUpdateMerchantBranding();

  useEffect(() => {
    if (!merchantId) return;
    fetch(`${base}/api/merchants/${merchantId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}` },
    })
      .then(r => r.json())
      .then(data => {
        const url = data.logoUrl ?? "";
        setLogoUrl(url);
        setSavedLogoUrl(url || null);
        setBrandColor(data.brandColor ?? "");
        setLogoError(false);
      })
      .catch(() => {});
  }, [merchantId]);

  function handleSave() {
    if (!merchantId) return;
    updateBranding.mutate(
      {
        id: merchantId,
        data: {
          logoUrl: logoUrl.trim() || null,
          brandColor: brandColor.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Branding saved");
          qc.invalidateQueries({ queryKey: ["getMerchant"] });
          const newSaved = logoUrl.trim() || null;
          setSavedLogoUrl(newSaved);
          setSavedLogoError(false);
          setIsReplacing(false);
          if (!newSaved) setLogoError(false);
        },
        onError: () => toast.error("Failed to save branding"),
      }
    );
  }

  function handleReset() {
    setLogoUrl("");
    setBrandColor("");
    setLogoError(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadFile(file);
    e.target.value = "";
  }

  const accent = brandColor && isValidHex(brandColor) ? brandColor : null;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payment Page Branding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customise how your payment page looks to customers — add your logo and brand colour.
        </p>
      </div>

      {/* Saved logo broken warning */}
      {savedLogoError && savedLogoUrl && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-400 [&>svg]:text-amber-400">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            Your saved logo can't be loaded — it may have been moved, deleted, or blocked by CORS. Customers on your payment page will see the default RasoKart branding instead. Click <strong>Replace</strong> to upload a new one.
          </AlertDescription>
        </Alert>
      )}

      {/* Logo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-primary" />
            Logo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current saved logo thumbnail */}
          {savedLogoUrl && !isReplacing ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                {savedLogoError ? (
                  <span className="text-xs text-rose-400 flex items-center gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5" /> Logo can't be loaded
                  </span>
                ) : (
                  <img
                    src={savedLogoUrl}
                    alt="Current logo"
                    className="h-10 max-w-[160px] object-contain rounded"
                    onError={() => setSavedLogoError(true)}
                    onLoad={() => setSavedLogoError(false)}
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => { setIsReplacing(true); setLogoUrl(savedLogoUrl); setLogoError(false); }}
                >
                  <Upload className="w-3.5 h-3.5" /> Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground"
                  onClick={() => { setLogoUrl(""); setLogoError(false); setSavedLogoError(false); setIsReplacing(true); }}
                >
                  <X className="w-3.5 h-3.5" /> Remove
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Upload button */}
              <div className="space-y-2">
                <Label>Upload Logo File</Label>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                    ) : (
                      <><Upload className="w-4 h-4" /> Choose File</>
                    )}
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-muted-foreground"
                      onClick={() => { setLogoUrl(""); setLogoError(false); }}
                    >
                      <X className="w-3.5 h-3.5" /> Clear
                    </Button>
                  )}
                  {isReplacing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-muted-foreground"
                      onClick={() => { setLogoUrl(savedLogoUrl ?? ""); setLogoError(false); setIsReplacing(false); }}
                    >
                      Cancel
                    </Button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, SVG, WebP, or JPEG. Max display height is 40 px.
                </p>
              </div>

              {/* URL fallback */}
              <div className="space-y-2">
                <Label htmlFor="logoUrl">Or paste a URL</Label>
                <Input
                  id="logoUrl"
                  placeholder="https://yourbrand.com/logo.png"
                  value={logoUrl}
                  onChange={e => { setLogoUrl(e.target.value); setLogoError(false); }}
                />
              </div>

              {logoUrl && (
                <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                  <p className="text-xs text-muted-foreground shrink-0">Preview:</p>
                  {logoError ? (
                    <span className="text-xs text-rose-400">Could not load image — check the URL</span>
                  ) : (
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      className="h-10 max-w-[160px] object-contain rounded"
                      onError={() => setLogoError(true)}
                      onLoad={() => setLogoError(false)}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Brand colour */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="w-4 h-4 text-primary" />
            Brand Colour
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brandColor">Hex colour</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={accent ?? "#6366f1"}
                onChange={e => setBrandColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5"
              />
              <Input
                id="brandColor"
                placeholder="#6366f1"
                value={brandColor}
                onChange={e => setBrandColor(e.target.value)}
                className="max-w-[160px] font-mono"
              />
              {accent && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-4 h-4 rounded-full border border-white/20" style={{ background: accent }} />
                  <span>{brandColor}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Used to tint the header, button, and icon on your payment page.
            </p>
          </div>

          {/* Presets */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Quick pick:</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c.value}
                  title={c.label}
                  onClick={() => setBrandColor(c.value)}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none"
                  style={{
                    background: c.value,
                    borderColor: brandColor === c.value ? "white" : "transparent",
                  }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
            {/* Mocked payment page header */}
            <div
              className="px-5 py-4 border-b border-border/40"
              style={accent
                ? { background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 12%, transparent), color-mix(in srgb, ${accent} 6%, transparent))` }
                : { background: "linear-gradient(135deg, hsl(var(--primary)/0.10), hsl(var(--primary)/0.05))" }
              }
            >
              <div className="flex items-center gap-2 mb-3">
                {logoUrl && !logoError ? (
                  <img src={logoUrl} alt="logo" className="h-8 max-w-[120px] object-contain rounded" />
                ) : (
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center border"
                    style={accent
                      ? { background: `color-mix(in srgb, ${accent} 20%, transparent)`, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }
                      : { background: "hsl(var(--primary)/0.2)", borderColor: "hsl(var(--primary)/0.3)" }
                    }
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" style={accent ? { color: accent } : { color: "hsl(var(--primary))" }} />
                  </div>
                )}
                {!logoUrl && <span className="font-bold text-sm">RasoKart</span>}
              </div>
              <p className="font-semibold text-sm">My Store — Order #1234</p>
              <p className="text-2xl font-bold mt-2">₹1,500.00</p>
            </div>
            <div className="px-5 py-4">
              <button
                className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: accent ?? "hsl(var(--primary))" }}
              >
                Open in UPI App
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={updateBranding.isPending} className="gap-2">
          <Save className="w-4 h-4" />
          {updateBranding.isPending ? "Saving…" : "Save Branding"}
        </Button>
        <Button variant="outline" onClick={handleReset} className="gap-2">
          <RotateCcw className="w-4 h-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}
