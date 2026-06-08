import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ExportCsvButtonProps {
  onExport: () => Promise<void> | void;
  disabled?: boolean;
  label?: string;
}

export function ExportCsvButton({ onExport, disabled, label = "Export CSV" }: ExportCsvButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleClick = async () => {
    setExporting(true);
    try {
      await onExport();
    } catch {
      toast.error("Export failed");
    } finally {
      setTimeout(() => setExporting(false), 600);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={exporting || disabled}>
      {exporting
        ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
        : <Download className="w-4 h-4 mr-1.5" />}
      {exporting ? "Exporting…" : label}
    </Button>
  );
}

export async function downloadCsvFromUrl(url: string, filename: string, params?: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => { if (v) searchParams.set(k, v); });
  }
  const res = await fetch(`${url}?${searchParams.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
