import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useContext,
  createContext,
  Children,
  isValidElement,
  type ReactNode,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Play,
  Loader2,
  KeyRound,
  Terminal,
  Plus,
  X,
  Star,
  Trash2,
  Save,
  AlertTriangle,
  Share2,
  Clock,
  LinkIcon,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre
        className={`bg-black/60 border border-border/50 rounded-lg p-4 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap`}
      >
        {code}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
        onClick={handleCopy}
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </Button>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  const shared = useContext(SharedPresetContext);
  const containsShared = useMemo(
    () => sectionContainsSharedPanel(children, shared),
    [children, shared]
  );
  const [open, setOpen] = useState(() => containsShared);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containsShared) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card
      ref={cardRef}
      className={`overflow-hidden ${containsShared ? "ring-1 ring-primary/50" : ""}`}
    >
      <CardHeader className="cursor-pointer select-none py-4" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {open ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base">{title}</CardTitle>
            {badge && (
              <Badge variant="secondary" className="text-[10px]">
                {badge}
              </Badge>
            )}
            {containsShared && (
              <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">
                Shared link
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0 space-y-5 pb-5">{children}</CardContent>}
    </Card>
  );
}

function EndpointRow({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description?: string;
}) {
  const colors: Record<string, string> = {
    GET: "bg-blue-500/20 text-blue-400",
    POST: "bg-emerald-500/20 text-emerald-400",
    PUT: "bg-yellow-500/20 text-yellow-400",
    PATCH: "bg-orange-500/20 text-orange-400",
    DELETE: "bg-rose-500/20 text-rose-400",
  };
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <Badge className={`text-[10px] font-bold shrink-0 ${colors[method] ?? ""}`}>{method}</Badge>
      <div>
        <code className="text-sm font-mono text-foreground">{path}</code>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

interface BodyFieldSchema {
  key: string;
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
}

interface TryItPanelProps {
  method: string;
  path: string;
  token: string;
  defaultBody?: string;
  requiresAuth?: boolean;
  commonQueryParams?: string[];
  expectedBodyKeys?: BodyFieldSchema[];
}

function looksLikeCredential(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("rasokart_live_") || trimmed.startsWith("rasokart_secret_")) return true;
  const parts = trimmed.split(".");
  if (parts.length === 3 && parts[0].startsWith("ey") && parts[1].startsWith("ey")) return true;
  return false;
}

function walkJsonStrings(value: unknown, path: string, found: { path: string; value: string }[]) {
  if (typeof value === "string") {
    if (looksLikeCredential(value)) found.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walkJsonStrings(item, `${path}[${i}]`, found));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkJsonStrings(v, path ? `${path}.${k}` : k, found);
    }
  }
}

function truncateCredentialValue(value: string, maxLen = 24): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "…";
}

function collectCredentialWarnings(
  queryParams: { key: string; value: string }[],
  body: string,
  pathValues: Record<string, string>
): string[] {
  const warnings: string[] = [];
  for (const row of queryParams) {
    if (row.key.trim() && looksLikeCredential(row.value)) {
      warnings.push(`query param "${row.key}" = "${truncateCredentialValue(row.value)}"`);
    }
  }
  for (const [key, val] of Object.entries(pathValues)) {
    if (looksLikeCredential(val)) {
      warnings.push(`path param "{${key}}" = "${truncateCredentialValue(val)}"`);
    }
  }
  if (body.trim()) {
    try {
      const parsed: unknown = JSON.parse(body);
      const found: { path: string; value: string }[] = [];
      walkJsonStrings(parsed, "", found);
      for (const hit of found) {
        warnings.push(hit.path ? `body field "${hit.path}"` : "request body");
      }
    } catch {
      if (looksLikeCredential(body)) {
        warnings.push("request body");
      }
    }
  }
  return warnings;
}

function getUnknownBodyKeys(body: string, schema: BodyFieldSchema[]): string[] {
  if (schema.length === 0 || !body.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const expectedKeys = schema.map((f) => f.key);
    return Object.keys(parsed as Record<string, unknown>).filter(
      (key) => !expectedKeys.includes(key)
    );
  } catch {
    return [];
  }
}

interface BodyTypeMismatch {
  key: string;
  expected: string;
  actual: string;
}

function getMismatchedBodyTypes(body: string, schema: BodyFieldSchema[]): BodyTypeMismatch[] {
  if (schema.length === 0 || !body.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const obj = parsed as Record<string, unknown>;
    const mismatches: BodyTypeMismatch[] = [];
    for (const field of schema) {
      if (!(field.key in obj)) continue;
      const value = obj[field.key];
      if (value === null) continue;
      const actual = Array.isArray(value) ? "array" : typeof value;
      let matches = false;
      switch (field.type) {
        case "string":
          matches = typeof value === "string";
          break;
        case "number":
        case "integer":
          matches = typeof value === "number";
          break;
        case "boolean":
          matches = typeof value === "boolean";
          break;
        case "object":
          matches = typeof value === "object" && !Array.isArray(value);
          break;
        case "array":
          matches = Array.isArray(value);
          break;
      }
      if (!matches) {
        mismatches.push({ key: field.key, expected: field.type, actual });
      }
    }
    return mismatches;
  } catch {
    return [];
  }
}

const BODY_EDITOR_LINE_HEIGHT_PX = 16;
const BODY_EDITOR_PADDING_TOP_PX = 8;

function getMismatchLineNumbers(
  body: string,
  mismatches: BodyTypeMismatch[]
): Map<number, BodyTypeMismatch[]> {
  const map = new Map<number, BodyTypeMismatch[]>();
  if (mismatches.length === 0) return map;
  const lines = body.split("\n");
  const remaining = new Set(mismatches.map((m) => m.key));
  for (let idx = 0; idx < lines.length; idx++) {
    if (remaining.size === 0) break;
    const line = lines[idx] ?? "";
    for (const m of mismatches) {
      if (!remaining.has(m.key)) continue;
      const pattern = new RegExp(`^\\s*"${m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
      if (pattern.test(line)) {
        const arr = map.get(idx) ?? [];
        arr.push(m);
        map.set(idx, arr);
        remaining.delete(m.key);
      }
    }
  }
  return map;
}

interface QueryParamRow {
  id: number;
  key: string;
  value: string;
}

interface ApiResponse {
  status: number;
  statusText: string;
  body: string;
  durationMs: number;
  headers: Record<string, string>;
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/\{(\w+)\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

let queryParamRowId = 0;

const DESTRUCTIVE_PATH_KEYWORDS = [
  "suspend",
  "reinstate",
  "reject",
  "approve",
  "retry",
  "adjust",
];

interface SavedQueryPreset {
  id: string;
  name: string;
  pathValues: Record<string, string>;
  queryParams: { key: string; value: string }[];
  body: string;
}

const TRY_IT_PRESETS_STORAGE_KEY = "rasokart_admin_tryit_presets";

function presetsStorageKeyFor(method: string, path: string): string {
  return `${method} ${path}`;
}

const PRESETS_CHANGED_EVENT = "rasokart-admin-tryit-presets-changed";

function dispatchPresetsChanged() {
  try {
    window.dispatchEvent(new Event(PRESETS_CHANGED_EVENT));
  } catch {
    // non-fatal
  }
}

function loadAllPresets(): Record<string, SavedQueryPreset[]> {
  try {
    const raw = localStorage.getItem(TRY_IT_PRESETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Module-level callback registered by ApiDocs to forward every localStorage
 * save to the server.  Set on mount, cleared on unmount.
 */
let _serverSyncFn: ((all: Record<string, SavedQueryPreset[]>) => void) | null = null;

function saveAllPresets(all: Record<string, SavedQueryPreset[]>) {
  try {
    localStorage.setItem(TRY_IT_PRESETS_STORAGE_KEY, JSON.stringify(all));
    dispatchPresetsChanged();
  } catch {
    // localStorage may be unavailable
  }
  _serverSyncFn?.(all);
}

async function fetchPresetsFromServer(token: string): Promise<Record<string, SavedQueryPreset[]> | null> {
  try {
    if (!token) return null;
    const res = await fetch("/api/admin/tryit-presets", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: unknown };
    if (json?.data && typeof json.data === "object" && !Array.isArray(json.data)) {
      return json.data as Record<string, SavedQueryPreset[]>;
    }
    return null;
  } catch {
    return null;
  }
}

function applyServerPresets(serverPresets: Record<string, SavedQueryPreset[]>) {
  try {
    localStorage.setItem(TRY_IT_PRESETS_STORAGE_KEY, JSON.stringify(serverPresets));
    dispatchPresetsChanged();
  } catch {
    // ignore — localStorage may be unavailable
  }
}

async function pushPresetsToServer(
  all: Record<string, SavedQueryPreset[]>,
  token: string
): Promise<void> {
  try {
    if (!token) return;
    await fetch("/api/admin/tryit-presets", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ presets: all }),
    });
  } catch {
    // non-fatal — server sync failed, localStorage is the fallback
  }
}

function loadPresetsForEndpoint(method: string, path: string): SavedQueryPreset[] {
  const all = loadAllPresets();
  const presets = all[presetsStorageKeyFor(method, path)];
  return Array.isArray(presets) ? presets : [];
}

function persistPresetsForEndpoint(method: string, path: string, presets: SavedQueryPreset[]) {
  const all = loadAllPresets();
  if (presets.length > 0) {
    all[presetsStorageKeyFor(method, path)] = presets;
  } else {
    delete all[presetsStorageKeyFor(method, path)];
  }
  saveAllPresets(all);
}

interface FlatPreset {
  key: string;
  method: string;
  path: string;
  preset: SavedQueryPreset;
}

function parsePresetsKey(key: string): { method: string; path: string } {
  const spaceIdx = key.indexOf(" ");
  if (spaceIdx === -1) return { method: "", path: key };
  return { method: key.slice(0, spaceIdx), path: key.slice(spaceIdx + 1) };
}

function loadAllPresetsFlat(): FlatPreset[] {
  const all = loadAllPresets();
  const flat: FlatPreset[] = [];
  for (const key of Object.keys(all)) {
    const { method, path } = parsePresetsKey(key);
    const presets = all[key];
    if (!Array.isArray(presets)) continue;
    for (const preset of presets) {
      flat.push({ key, method, path, preset });
    }
  }
  flat.sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1));
  return flat;
}

function renamePresetGlobal(key: string, id: string, newName: string) {
  const all = loadAllPresets();
  const presets = all[key];
  if (!Array.isArray(presets)) return;
  all[key] = presets.map((p) => (p.id === id ? { ...p, name: newName } : p));
  saveAllPresets(all);
}

function deletePresetGlobal(key: string, id: string) {
  const all = loadAllPresets();
  const presets = all[key];
  if (!Array.isArray(presets)) return;
  const next = presets.filter((p) => p.id !== id);
  if (next.length > 0) {
    all[key] = next;
  } else {
    delete all[key];
  }
  saveAllPresets(all);
}

const SHARE_QUERY_PARAM = "tryit";

interface SharedTryItPreset {
  method: string;
  path: string;
  pathValues: Record<string, string>;
  queryParams: { key: string; value: string }[];
  body: string;
  expiresAt?: string;
  localToken?: string;
}

interface SharedPresetReadResult {
  preset: SharedTryItPreset | null;
  expired: boolean;
}

const EXPIRY_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "No expiry", minutes: null },
  { label: "1 hour", minutes: 60 },
  { label: "24 hours", minutes: 60 * 24 },
  { label: "7 days", minutes: 60 * 24 * 7 },
  { label: "30 days", minutes: 60 * 24 * 30 },
];

function findClosestExpiryOption(expiresAt: string): number | null {
  const ts = new Date(expiresAt).getTime();
  if (!Number.isFinite(ts)) return null;
  const remainingMs = ts - Date.now();
  if (remainingMs <= 0) return null;
  const remainingMinutes = remainingMs / 60000;
  const tieredOptions = EXPIRY_OPTIONS.filter((o) => o.minutes != null);
  if (tieredOptions.length === 0) return null;
  let closest = tieredOptions[0];
  let closestDiff = Math.abs((closest.minutes ?? 0) - remainingMinutes);
  for (const opt of tieredOptions) {
    const diff = Math.abs((opt.minutes ?? 0) - remainingMinutes);
    if (diff < closestDiff) {
      closest = opt;
      closestDiff = diff;
    }
  }
  return closest.minutes ?? null;
}

function formatRemainingTime(expiresAt: string): string {
  const ts = new Date(expiresAt).getTime();
  if (!Number.isFinite(ts)) return "expired";
  const remainingMs = ts - Date.now();
  if (remainingMs <= 0) return "expired";
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function encodeSharedPreset(preset: SharedTryItPreset): string {
  const json = JSON.stringify(preset);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeSharedPreset(encoded: string): SharedTryItPreset | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.method === "string" &&
      typeof parsed.path === "string" &&
      typeof parsed.body === "string" &&
      parsed.pathValues &&
      typeof parsed.pathValues === "object" &&
      Array.isArray(parsed.queryParams)
    ) {
      return {
        method: parsed.method,
        path: parsed.path,
        pathValues: parsed.pathValues,
        queryParams: parsed.queryParams.filter(
          (row: unknown): row is { key: string; value: string } =>
            !!row &&
            typeof row === "object" &&
            typeof (row as { key?: unknown }).key === "string" &&
            typeof (row as { value?: unknown }).value === "string"
        ),
        body: parsed.body,
        expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
        localToken: typeof parsed.localToken === "string" ? parsed.localToken : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function buildSharedPresetUrl(preset: SharedTryItPreset): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(SHARE_QUERY_PARAM, encodeSharedPreset(preset));
  return url.toString();
}

function readSharedPresetFromLocation(): SharedPresetReadResult {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get(SHARE_QUERY_PARAM);
    if (!encoded) return { preset: null, expired: false };
    const preset = decodeSharedPreset(encoded);
    if (!preset) return { preset: null, expired: false };
    if (preset.expiresAt && new Date(preset.expiresAt).getTime() < Date.now()) {
      return { preset: null, expired: true };
    }
    return { preset, expired: false };
  } catch {
    return { preset: null, expired: false };
  }
}

function stripSharedPresetFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SHARE_QUERY_PARAM)) return;
    url.searchParams.delete(SHARE_QUERY_PARAM);
    window.history.replaceState(null, "", url.toString());
  } catch {
    // non-fatal
  }
}

const SharedPresetContext = createContext<SharedTryItPreset | null>(null);

function sectionContainsSharedPanel(children: ReactNode, shared: SharedTryItPreset | null): boolean {
  if (!shared) return false;
  let found = false;
  Children.forEach(children, (child) => {
    if (found || !isValidElement(child)) return;
    if (child.type === TryItPanel) {
      const props = child.props as TryItPanelProps;
      if (props.method === shared.method && props.path === shared.path) {
        found = true;
        return;
      }
    }
    const nested = (child.props as { children?: ReactNode } | undefined)?.children;
    if (nested && sectionContainsSharedPanel(nested, shared)) {
      found = true;
    }
  });
  return found;
}

function TryItPanel({
  method,
  path,
  token,
  defaultBody = "",
  requiresAuth = true,
  commonQueryParams = [],
  expectedBodyKeys = [],
}: TryItPanelProps) {
  const shared = useContext(SharedPresetContext);
  const sharedMatch =
    shared && shared.method === method && shared.path === path ? shared : null;
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(() => !!sharedMatch);
  const [localToken, setLocalToken] = useState(() => sharedMatch?.localToken ?? token);
  const [body, setBody] = useState(() => sharedMatch?.body ?? defaultBody);
  const [pathValues, setPathValues] = useState<Record<string, string>>(
    () => sharedMatch?.pathValues ?? {}
  );
  const [queryParams, setQueryParams] = useState<QueryParamRow[]>(() =>
    sharedMatch
      ? sharedMatch.queryParams.map((row) => ({ id: ++queryParamRowId, key: row.key, value: row.value }))
      : []
  );
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [curlCopied, setCurlCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [headersCopied, setHeadersCopied] = useState(false);
  const [copiedHeaderKey, setCopiedHeaderKey] = useState<string | null>(null);
  const [presets, setPresets] = useState<SavedQueryPreset[]>(() =>
    loadPresetsForEndpoint(method, path)
  );
  const [presetName, setPresetName] = useState("");
  const [presetCredentialWarnings, setPresetCredentialWarnings] = useState<string[]>([]);
  const [presetLoadWarnings, setPresetLoadWarnings] = useState<{
    id: string;
    warnings: string[];
    originQueryParamKeys: string[];
    originPathParamKeys: string[];
    originBodyPaths: string[];
  } | null>(null);

  const suggestedExpiryMinutes = useMemo(
    () => (sharedMatch?.expiresAt ? findClosestExpiryOption(sharedMatch.expiresAt) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (sharedMatch) {
      toast.success("Loaded request setup from shared link");
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePresetsChanged = () => {
      setPresets(loadPresetsForEndpoint(method, path));
    };
    window.addEventListener(PRESETS_CHANGED_EVENT, handlePresetsChanged);
    return () => window.removeEventListener(PRESETS_CHANGED_EVENT, handlePresetsChanged);
  }, [method, path]);

  useEffect(() => {
    setPresetCredentialWarnings([]);
  }, [body, queryParams, pathValues]);

  useEffect(() => {
    setPresetLoadWarnings((prev) => {
      if (!prev) return prev;

      const activeQueryParams = prev.originQueryParamKeys.filter((key) => {
        const row = queryParams.find((r) => r.key === key);
        return row ? looksLikeCredential(row.value) : false;
      });

      const activePathParams = prev.originPathParamKeys.filter((key) =>
        looksLikeCredential(pathValues[key] ?? "")
      );

      let activeBodyPaths: string[] = [];
      if (prev.originBodyPaths.length > 0) {
        if (prev.originBodyPaths.includes("") && looksLikeCredential(body)) {
          activeBodyPaths = [""];
        } else {
          const currentBodyCredPaths = new Set<string>();
          try {
            const parsed = JSON.parse(body) as unknown;
            const found: { path: string; value: string }[] = [];
            walkJsonStrings(parsed, "", found);
            found.forEach((f) => currentBodyCredPaths.add(f.path));
          } catch {
            // body is not valid JSON — raw credential check handled above
          }
          activeBodyPaths = prev.originBodyPaths.filter((p) => currentBodyCredPaths.has(p));
        }
      }

      const totalActive = activeQueryParams.length + activePathParams.length + activeBodyPaths.length;
      if (totalActive === 0) return null;

      const newWarnings: string[] = [];
      for (const key of activeQueryParams) {
        const row = queryParams.find((r) => r.key === key);
        if (row) newWarnings.push(`query param "${key}" = "${truncateCredentialValue(row.value)}"`);
      }
      for (const key of activePathParams) {
        const val = pathValues[key] ?? "";
        newWarnings.push(`path param "{${key}}" = "${truncateCredentialValue(val)}"`);
      }
      for (const p of activeBodyPaths) {
        newWarnings.push(p ? `body field "${p}"` : "request body");
      }

      if (
        newWarnings.length === prev.warnings.length &&
        newWarnings.every((w, i) => w === prev.warnings[i])
      ) {
        return prev;
      }
      return { ...prev, warnings: newWarnings };
    });
  }, [body, queryParams, pathValues]);

  const params = extractPathParams(path);
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  const supportsQueryParams = method === "GET" || method === "DELETE";
  const unknownBodyKeys = useMemo(
    () => getUnknownBodyKeys(body, expectedBodyKeys),
    [body, expectedBodyKeys]
  );
  const typeMismatches = useMemo(
    () => getMismatchedBodyTypes(body, expectedBodyKeys),
    [body, expectedBodyKeys]
  );

  const mismatchLines = useMemo(
    () => getMismatchLineNumbers(body, typeMismatches),
    [body, typeMismatches]
  );
  const [bodyScrollTop, setBodyScrollTop] = useState(0);

  useEffect(() => {
    setLocalToken(token);
  }, [token]);

  const buildUrl = useCallback(() => {
    let resolved = path;
    for (const [k, v] of Object.entries(pathValues)) {
      resolved = resolved.replace(`{${k}}`, encodeURIComponent(v));
    }
    const base = window.location.origin;
    const url = new URL(base + resolved);
    for (const row of queryParams) {
      if (row.key.trim()) url.searchParams.append(row.key.trim(), row.value);
    }
    return url.toString();
  }, [path, pathValues, queryParams]);

  const buildCurl = useCallback(() => {
    const url = buildUrl();
    const lines: string[] = [`curl -X ${method} '${url}'`];
    if (requiresAuth && localToken) {
      lines.push(`  -H 'Authorization: Bearer ${localToken}'`);
    }
    if (hasBody) {
      lines.push(`  -H 'Content-Type: application/json'`);
      const trimmed = body.trim();
      if (trimmed) {
        lines.push(`  -d '${trimmed.replace(/'/g, "'\\''")}'`);
      }
    }
    return lines.join(" \\\n");
  }, [method, buildUrl, requiresAuth, localToken, hasBody, body]);

  const isDestructive = useMemo(() => {
    if (method === "DELETE") return true;
    if (method === "POST") {
      return DESTRUCTIVE_PATH_KEYWORDS.some((keyword) => path.toLowerCase().includes(keyword));
    }
    return false;
  }, [method, path]);

  const [confirmingRun, setConfirmingRun] = useState(false);

  const executeRun = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    const url = buildUrl();
    const headers: Record<string, string> = {};
    if (requiresAuth && localToken) {
      headers["Authorization"] = `Bearer ${localToken}`;
    }
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }
    const start = performance.now();
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: hasBody && body.trim() ? body.trim() : undefined,
      });
      const durationMs = Math.round(performance.now() - start);
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      const text = await res.text();
      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: text,
        durationMs,
        headers: responseHeaders,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      setResponse({
        status: 0,
        statusText: "Network Error",
        body: err instanceof Error ? err.message : String(err),
        durationMs,
        headers: {},
      });
    } finally {
      setLoading(false);
    }
  }, [buildUrl, method, requiresAuth, localToken, hasBody, body]);

  const handleRun = useCallback(() => {
    if (isDestructive && !confirmingRun) {
      setConfirmingRun(true);
      return;
    }
    setConfirmingRun(false);
    void executeRun();
  }, [isDestructive, confirmingRun, executeRun]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmingRun(false);
  }, []);

  const addQueryParam = useCallback((key = "", value = "") => {
    setQueryParams((prev) => [...prev, { id: ++queryParamRowId, key, value }]);
  }, []);

  const updateQueryParam = useCallback((id: number, field: "key" | "value", val: string) => {
    setQueryParams((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  }, []);

  const removeQueryParam = useCallback((id: number) => {
    setQueryParams((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const handleAddCommonParam = useCallback(
    (key: string) => {
      if (!queryParams.some((row) => row.key === key)) {
        addQueryParam(key, "");
      }
    },
    [queryParams, addQueryParam]
  );

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const warnings = collectCredentialWarnings(
      queryParams.map((row) => ({ key: row.key, value: row.value })),
      body,
      pathValues
    );
    const newPreset: SavedQueryPreset = {
      id: crypto.randomUUID(),
      name,
      pathValues: { ...pathValues },
      queryParams: queryParams.map(({ key, value }) => ({ key, value })),
      body,
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    persistPresetsForEndpoint(method, path, updated);
    setPresetName("");
    setPresetCredentialWarnings(warnings);
    toast.success(`Preset "${name}" saved`);
  }, [presetName, queryParams, body, pathValues, presets, method, path]);

  const handleLoadPreset = useCallback(
    (preset: SavedQueryPreset) => {
      setPathValues(preset.pathValues);
      setQueryParams(
        preset.queryParams.map((row) => ({ id: ++queryParamRowId, key: row.key, value: row.value }))
      );
      setBody(preset.body);
      const warnings = collectCredentialWarnings(preset.queryParams, preset.body, preset.pathValues);
      if (warnings.length > 0) {
        const originQueryParamKeys = preset.queryParams
          .filter((row) => row.key.trim() && looksLikeCredential(row.value))
          .map((row) => row.key);
        const originPathParamKeys = Object.entries(preset.pathValues)
          .filter(([, val]) => looksLikeCredential(val))
          .map(([key]) => key);
        const originBodyPaths: string[] = [];
        if (preset.body.trim()) {
          try {
            const parsed = JSON.parse(preset.body) as unknown;
            const found: { path: string; value: string }[] = [];
            walkJsonStrings(parsed, "", found);
            found.forEach((f) => originBodyPaths.push(f.path));
          } catch {
            if (looksLikeCredential(preset.body)) originBodyPaths.push("");
          }
        }
        setPresetLoadWarnings({ id: preset.id, warnings, originQueryParamKeys, originPathParamKeys, originBodyPaths });
      } else {
        setPresetLoadWarnings(null);
      }
      toast.success(`Preset "${preset.name}" loaded`);
    },
    []
  );

  const handleDeletePreset = useCallback(
    (id: string) => {
      const updated = presets.filter((p) => p.id !== id);
      setPresets(updated);
      persistPresetsForEndpoint(method, path, updated);
      setPresetLoadWarnings((prev) => (prev && prev.id === id ? null : prev));
    },
    [presets, method, path]
  );

  const handleCopyCurl = useCallback(() => {
    navigator.clipboard.writeText(buildCurl());
    setCurlCopied(true);
    toast.success("cURL command copied");
    setTimeout(() => setCurlCopied(false), 2000);
  }, [buildCurl]);

  // Share link state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStripToken, setShareStripToken] = useState(true);
  const [shareExpiryMinutes, setShareExpiryMinutes] = useState<number | null>(
    suggestedExpiryMinutes ?? null
  );
  const [showShareWarning, setShowShareWarning] = useState(false);
  const [shareCredentialWarnings, setShareCredentialWarnings] = useState<string[]>([]);

  const doShare = useCallback(() => {
    const expiresAt =
      shareExpiryMinutes != null
        ? new Date(Date.now() + shareExpiryMinutes * 60 * 1000).toISOString()
        : undefined;
    const preset: SharedTryItPreset = {
      method,
      path,
      pathValues,
      queryParams: queryParams.map(({ key, value }) => ({ key, value })),
      body,
      expiresAt,
      localToken: shareStripToken ? undefined : localToken,
    };
    const url = buildSharedPresetUrl(preset);
    navigator.clipboard.writeText(url);
    setShareCopied(true);
    toast.success("Share link copied to clipboard");
    setTimeout(() => setShareCopied(false), 2000);
    setShareOpen(false);
  }, [method, path, pathValues, queryParams, body, shareExpiryMinutes, shareStripToken, localToken]);

  const handleShare = useCallback(() => {
    const filteredParams = queryParams
      .filter((row) => row.key.trim().length > 0)
      .map((row) => ({ key: row.key, value: row.value }));
    const warnings = collectCredentialWarnings(filteredParams, body, pathValues);
    if (warnings.length > 0) {
      setShareCredentialWarnings(warnings);
      setShareOpen(false);
      setShowShareWarning(true);
      return;
    }
    doShare();
  }, [queryParams, body, pathValues, doShare]);

  const prettyBody = useMemo(() => {
    if (!response) return "";
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }, [response]);

  const statusColor = response
    ? response.status >= 200 && response.status < 300
      ? "text-emerald-400"
      : response.status >= 400
      ? "text-rose-400"
      : "text-amber-400"
    : "";

  return (
    <div
      ref={panelRef}
      className={`rounded-lg border ${
        sharedMatch ? "border-primary/40 bg-primary/5" : "border-border/40 bg-black/20"
      } overflow-hidden`}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none hover:bg-white/5 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground flex-1">Try it</span>
        <div className="flex items-center gap-2">
          {presets.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
              <Star className="w-2.5 h-2.5" />
              {presets.length}
            </span>
          )}
          {open ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/30">
          <div className="pt-3 space-y-1.5">
            <div className="flex flex-wrap gap-1.5 items-center">
              {presets.length > 0 &&
                presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border/40 bg-black/30"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadPreset(preset)}
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Star className="w-2.5 h-2.5" />
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(preset.id)}
                      className="text-muted-foreground hover:text-rose-400 transition-colors p-0.5"
                      aria-label={`Delete preset ${preset.name}`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
            </div>
            {presetLoadWarnings && (
              <p className="text-[10px] text-amber-500/80 pl-0.5 flex items-start gap-1">
                <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-px" />
                <span>
                  This preset contains{" "}
                  {presetLoadWarnings.warnings.length === 1 ? (
                    <span className="font-mono">{presetLoadWarnings.warnings[0]}</span>
                  ) : (
                    presetLoadWarnings.warnings.map((w, i) => (
                      <span key={w}>
                        {i > 0 && (i === presetLoadWarnings.warnings.length - 1 ? " and " : ", ")}
                        <span className="font-mono">{w}</span>
                      </span>
                    ))
                  )}{" "}
                  that look{presetLoadWarnings.warnings.length === 1 ? "s" : ""} like a saved token or API key — it may be outdated or rotated.
                </span>
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                value={presetName}
                onChange={(e) => {
                  setPresetName(e.target.value);
                  setPresetCredentialWarnings([]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSavePreset();
                  }
                }}
                placeholder="Preset name (e.g. This week, merchant 42)"
                className="h-7 text-xs bg-black/40 flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 shrink-0"
                disabled={!presetName.trim()}
                onClick={handleSavePreset}
              >
                <Save className="w-3 h-3" />
                Save
              </Button>
            </div>
            {presetCredentialWarnings.length > 0 && (
              <p className="text-[10px] text-amber-500/80 pl-0.5 flex items-start gap-1">
                <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-px" />
                <span>
                  Preset saved — but{" "}
                  {presetCredentialWarnings.length === 1 ? (
                    <span className="font-mono">{presetCredentialWarnings[0]}</span>
                  ) : (
                    presetCredentialWarnings.map((w, i) => (
                      <span key={w}>
                        {i > 0 && (i === presetCredentialWarnings.length - 1 ? " and " : ", ")}
                        <span className="font-mono">{w}</span>
                      </span>
                    ))
                  )}{" "}
                  look{presetCredentialWarnings.length === 1 ? "s" : ""} like a token or API key.
                  Presets are stored in localStorage and visible to any script on this origin.
                </span>
              </p>
            )}
          </div>

          {requiresAuth && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bearer Token</Label>
              <Input
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                placeholder="Paste your admin JWT token here"
                className="h-7 text-xs font-mono bg-black/40"
              />
            </div>
          )}

          {params.length > 0 && (
            <div className="space-y-2">
              {params.map((param) => (
                <div key={param} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Path param: <code className="font-mono">{`{${param}}`}</code>
                  </Label>
                  <Input
                    value={pathValues[param] ?? ""}
                    onChange={(e) =>
                      setPathValues((prev) => ({ ...prev, [param]: e.target.value }))
                    }
                    placeholder={`Enter ${param}`}
                    className="h-7 text-xs font-mono bg-black/40"
                  />
                </div>
              ))}
            </div>
          )}

          {supportsQueryParams && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Query Parameters</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] gap-1 px-2"
                  onClick={() => addQueryParam()}
                >
                  <Plus className="w-3 h-3" />
                  Add param
                </Button>
              </div>

              {commonQueryParams.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {commonQueryParams.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleAddCommonParam(key)}
                      disabled={queryParams.some((row) => row.key === key)}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/50 bg-black/30 text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              )}

              {queryParams.length > 0 && (
                <div className="space-y-1.5">
                  {queryParams.map((row) => {
                    const isUnknownParam =
                      commonQueryParams.length > 0 &&
                      row.key.trim().length > 0 &&
                      !commonQueryParams.includes(row.key.trim());
                    return (
                      <div key={row.id} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={row.key}
                            onChange={(e) => updateQueryParam(row.id, "key", e.target.value)}
                            placeholder="key"
                            className={`h-7 text-xs font-mono bg-black/40 w-1/3 ${
                              isUnknownParam ? "border-amber-500/50 focus-visible:ring-amber-500/30" : ""
                            }`}
                          />
                          <Input
                            value={row.value}
                            onChange={(e) => updateQueryParam(row.id, "value", e.target.value)}
                            placeholder="value"
                            className="h-7 text-xs font-mono bg-black/40 flex-1"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => removeQueryParam(row.id)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        {isUnknownParam && (
                          <p className="text-[10px] text-amber-500/80 pl-0.5 flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                            "{row.key.trim()}" isn't a documented param for this endpoint — it may be
                            ignored by the server.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {hasBody && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Request Body (JSON)</Label>
              <div className="relative">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onScroll={(e) => setBodyScrollTop(e.currentTarget.scrollTop)}
                  wrap="off"
                  rows={6}
                  className={`text-xs font-mono bg-black/40 resize-y ${
                    mismatchLines.size > 0 ? "pl-4" : ""
                  } ${
                    unknownBodyKeys.length > 0 || typeMismatches.length > 0
                      ? "border-amber-500/50 focus-visible:ring-amber-500/30"
                      : ""
                  }`}
                  spellCheck={false}
                />
                {mismatchLines.size > 0 && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-3 overflow-hidden rounded-l-md pointer-events-none"
                    aria-hidden="false"
                  >
                    <div
                      className="relative"
                      style={{ transform: `translateY(-${bodyScrollTop}px)` }}
                    >
                      {Array.from(mismatchLines.entries()).map(([lineIdx, lineMismatches]) => (
                        <TooltipProvider key={lineIdx}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                role="button"
                                tabIndex={0}
                                aria-label={`Type mismatch on line ${lineIdx + 1}`}
                                className="absolute left-0 w-3 bg-amber-500/70 hover:bg-amber-400 pointer-events-auto cursor-help"
                                style={{
                                  top: `${BODY_EDITOR_PADDING_TOP_PX + lineIdx * BODY_EDITOR_LINE_HEIGHT_PX}px`,
                                  height: `${BODY_EDITOR_LINE_HEIGHT_PX}px`,
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-[11px] space-y-1">
                              {lineMismatches.map((m) => (
                                <div key={m.key} className="font-mono">
                                  "{m.key}": expected <span className="text-emerald-300">{m.expected}</span>, got{" "}
                                  <span className="text-rose-300">{m.actual}</span>
                                </div>
                              ))}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {unknownBodyKeys.length > 0 && (
                <p className="text-[10px] text-amber-500/80 pl-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                  {unknownBodyKeys.length === 1
                    ? `"${unknownBodyKeys[0]}" isn't a documented field for this endpoint`
                    : `${unknownBodyKeys.map((key) => `"${key}"`).join(", ")} aren't documented fields for this endpoint`}
                  {" "}— it may be ignored by the server.
                </p>
              )}
              {typeMismatches.map((m) => (
                <p
                  key={m.key}
                  className="text-[10px] text-amber-500/80 pl-0.5 flex items-center gap-1"
                >
                  <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                  <span>
                    <span className="font-mono">"{m.key}"</span> should be{" "}
                    <span className="font-mono">{m.expected}</span> but got{" "}
                    <span className="font-mono">{m.actual}</span>.
                  </span>
                </p>
              ))}
            </div>
          )}

          {confirmingRun && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-300" />
              <span className="font-medium">This will modify live data — confirm?</span>
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleRun}
                >
                  <Play className="w-3 h-3" />
                  Confirm & Run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleCancelConfirm}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleRun}
              disabled={loading}
              variant={isDestructive ? "destructive" : "default"}
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {loading ? "Running…" : "Run"}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={handleCopyCurl}
                  >
                    {curlCopied ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    cURL
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Copy as cURL command
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Popover open={shareOpen} onOpenChange={setShareOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                  {shareCopied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Share2 className="w-3 h-3" />
                  )}
                  Share
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-3" align="start">
                <div className="space-y-1">
                  <p className="text-xs font-medium">Share this request setup</p>
                  <p className="text-[11px] text-muted-foreground">
                    Creates a URL that pre-fills this panel for anyone you share it with.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Expiry
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {EXPIRY_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setShareExpiryMinutes(opt.minutes)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                          shareExpiryMinutes === opt.minutes
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-border/50 bg-black/20 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {sharedMatch?.expiresAt && (
                    <p className="text-[10px] text-amber-500/80 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      This link expires in {formatRemainingTime(sharedMatch.expiresAt)}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shareStripToken}
                      onChange={(e) => setShareStripToken(e.target.checked)}
                      className="rounded w-3 h-3"
                    />
                    Strip auth token from link
                  </label>
                </div>
                {!shareStripToken && (
                  <p className="text-[10px] text-amber-500/80 flex items-start gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-px" />
                    Your bearer token will be embedded in the URL — only share with trusted
                    colleagues.
                  </p>
                )}

                <Button size="sm" className="w-full h-7 text-xs gap-1.5" onClick={handleShare}>
                  <LinkIcon className="w-3 h-3" />
                  Copy share link
                </Button>
              </PopoverContent>
            </Popover>
          </div>

          {response && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-3 text-xs">
                <span className={`font-mono font-bold ${statusColor}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-muted-foreground">{response.durationMs}ms</span>
              </div>
              <Tabs defaultValue="body" className="w-full">
                <TabsList className="h-7 text-xs">
                  <TabsTrigger value="body" className="text-xs h-6">
                    Body
                  </TabsTrigger>
                  <TabsTrigger value="headers" className="text-xs h-6">
                    Headers ({Object.keys(response.headers).length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="body" className="mt-2">
                  <div className="relative group">
                    <pre className="bg-black/60 border border-border/50 rounded-lg p-3 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {prettyBody}
                    </pre>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
                      onClick={() => {
                        navigator.clipboard.writeText(prettyBody);
                        toast.success("Response copied");
                      }}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="headers" className="mt-2">
                  <div className="relative group">
                    <div className="bg-black/60 border border-border/50 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(response.headers).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-start gap-2 text-xs font-mono group/row"
                        >
                          <span className="text-muted-foreground shrink-0 min-w-[160px]">{key}:</span>
                          <span className="text-green-300 break-all flex-1">{value}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-4 w-4 opacity-0 group-hover/row:opacity-100 shrink-0"
                            onClick={() => {
                              navigator.clipboard.writeText(value);
                              setCopiedHeaderKey(key);
                              setTimeout(() => setCopiedHeaderKey(null), 1500);
                            }}
                          >
                            {copiedHeaderKey === key ? (
                              <Check className="w-2.5 h-2.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
                      onClick={() => {
                        const text = Object.entries(response.headers)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join("\n");
                        navigator.clipboard.writeText(text);
                        setHeadersCopied(true);
                        setTimeout(() => setHeadersCopied(false), 1500);
                      }}
                    >
                      {headersCopied ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      )}
      <Dialog open={showShareWarning} onOpenChange={setShowShareWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Possible credential in share link
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground pt-1">
              The following field{shareCredentialWarnings.length > 1 ? "s" : ""} look{shareCredentialWarnings.length === 1 ? "s" : ""} like a token or API key:
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-1 space-y-1 pl-1">
            {shareCredentialWarnings.map((w) => (
              <li key={w} className="flex items-center gap-2 text-xs font-mono text-amber-300">
                <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                {w}
              </li>
            ))}
          </ul>
          {presetLoadWarnings && (
            <p className="text-xs text-amber-400/80 mt-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              These values were loaded from a preset — double-check that you intended to share them.
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Share links encode everything you've typed here into the URL. Anyone with the link will be able to see these values. Remove them before sharing, or continue only if you're sure this is safe.
          </p>
          <div className="flex gap-2 mt-3 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowShareWarning(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => {
                setShowShareWarning(false);
                doShare();
              }}
            >
              <Share2 className="w-3 h-3" />
              Share anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Manage Presets Dialog ────────────────────────────────────────────────────

const methodColors: Record<string, string> = {
  GET: "bg-blue-500/20 text-blue-400",
  POST: "bg-emerald-500/20 text-emerald-400",
  PUT: "bg-yellow-500/20 text-yellow-400",
  PATCH: "bg-orange-500/20 text-orange-400",
  DELETE: "bg-rose-500/20 text-rose-400",
};

function ManagePresetsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [items, setItems] = useState<FlatPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (open) setItems(loadAllPresetsFlat());
  }, [open]);

  useEffect(() => {
    const handler = () => setItems(loadAllPresetsFlat());
    window.addEventListener(PRESETS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(PRESETS_CHANGED_EVENT, handler);
  }, []);

  const startEditing = (item: FlatPreset) => {
    setEditingId(item.preset.id);
    setEditName(item.preset.name);
  };

  const commitEdit = (item: FlatPreset) => {
    const name = editName.trim();
    if (name && name !== item.preset.name) {
      renamePresetGlobal(item.key, item.preset.id, name);
    }
    setEditingId(null);
    setEditName("");
  };

  const handleDelete = (item: FlatPreset) => {
    deletePresetGlobal(item.key, item.preset.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            Saved Presets
          </DialogTitle>
          <DialogDescription className="text-xs">
            Manage all saved request presets across every panel on this page.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No presets saved yet. Use a "Try it" panel to save your first preset.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={`${item.key}-${item.preset.id}`}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/40 bg-black/20"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  {editingId === item.preset.id ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(item);
                        if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                      }}
                      onBlur={() => commitEdit(item)}
                      className="h-6 text-xs"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditing(item)}
                      className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors text-left truncate"
                      title="Click to rename"
                    >
                      <Star className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.preset.name}</span>
                    </button>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Badge className={`text-[10px] font-bold shrink-0 ${methodColors[item.method] ?? ""}`}>
                      {item.method}
                    </Badge>
                    <code className="text-[11px] font-mono text-muted-foreground truncate">
                      {item.path}
                    </code>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => startEditing(item)}
                  aria-label={`Rename preset ${item.preset.name}`}
                >
                  <Save className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-rose-400"
                  onClick={() => handleDelete(item)}
                  aria-label={`Delete preset ${item.preset.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function AdminApiDocs() {
  const [globalToken, setGlobalToken] = useState<string>(() => {
    try {
      return (
        localStorage.getItem("rasokart_admin_tryit_token") ??
        localStorage.getItem("rasokart_token") ??
        ""
      );
    } catch {
      return "";
    }
  });
  const [{ preset: sharedPreset, expired: sharedLinkExpired }] = useState<SharedPresetReadResult>(
    () => readSharedPresetFromLocation()
  );
  const [managePresetsOpen, setManagePresetsOpen] = useState(false);

  useEffect(() => {
    if (sharedPreset || sharedLinkExpired) {
      stripSharedPresetFromUrl();
    }
  }, [sharedPreset, sharedLinkExpired]);

  // Server-side preset persistence uses the admin's own session token (not the
  // "Try It" bearer token above, which may point at a different account/merchant).
  // This mirrors the merchant portal's pattern in merchant/api-docs.tsx.
  const adminSessionTokenRef = useRef<string>("");
  try {
    adminSessionTokenRef.current = localStorage.getItem("rasokart_token") ?? "";
  } catch {
    adminSessionTokenRef.current = "";
  }

  useEffect(() => {
    _serverSyncFn = (all) => {
      void pushPresetsToServer(all, adminSessionTokenRef.current);
    };
    return () => {
      _serverSyncFn = null;
    };
  }, []);

  // On mount: fetch presets from server. If server has data, overwrite localStorage.
  // If server is empty and localStorage has data, migrate to server (one-time).
  useEffect(() => {
    const token = adminSessionTokenRef.current;
    if (!token) return;
    let cancelled = false;
    void (async () => {
      const serverPresets = await fetchPresetsFromServer(token);
      if (cancelled) return;
      if (serverPresets && Object.keys(serverPresets).length > 0) {
        applyServerPresets(serverPresets);
      } else {
        const local = loadAllPresets();
        if (Object.keys(local).length > 0) {
          void pushPresetsToServer(local, token);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTokenChange = (val: string) => {
    setGlobalToken(val);
    try {
      localStorage.setItem("rasokart_admin_tryit_token", val);
    } catch {
      // ignore
    }
  };

  return (
    <SharedPresetContext.Provider value={sharedPreset}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin API Reference</h1>
            <p className="text-muted-foreground mt-1">
              Inspect, test, and debug admin-side API endpoints directly from this panel.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setManagePresetsOpen(true)}
          >
            <Star className="w-3.5 h-3.5" />
            Manage saved presets
          </Button>
        </div>

        <ManagePresetsDialog open={managePresetsOpen} onOpenChange={setManagePresetsOpen} />

        {sharedLinkExpired && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-300">This shared link has expired</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                The person who shared this link set an expiry. Ask them to generate a new share link.
              </p>
            </div>
          </div>
        )}

        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <p className="text-sm font-medium mb-2">Base URL</p>
            <CodeBlock code="https://your-domain.com/api" />
            <p className="text-xs text-muted-foreground">
              All admin requests must include an{" "}
              <code className="font-mono bg-muted px-1 rounded">
                Authorization: Bearer &lt;token&gt;
              </code>{" "}
              header. Use the admin login endpoint to obtain a token. Endpoints marked{" "}
              <Badge variant="secondary" className="text-[10px]">admin-only</Badge>{" "}
              reject merchant tokens with 403.
            </p>

            <div className="pt-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                <Label className="text-xs font-medium">
                  Shared Bearer Token{" "}
                  <span className="text-muted-foreground font-normal">
                    — pre-fills all "Try it" panels on this page
                  </span>
                </Label>
              </div>
              <Input
                value={globalToken}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="Paste your admin JWT once — it auto-fills every panel"
                className="h-8 text-xs font-mono bg-black/40 border-primary/30"
              />
              {!globalToken && (
                <p className="text-[11px] text-muted-foreground">
                  No token set. Use the Authentication section below to log in and paste the returned
                  token here.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">

          {/* ── Authentication ─────────────────────────────────────────────── */}
          <Section title="Authentication" badge="JWT Bearer">
            <p className="text-sm text-muted-foreground">
              Obtain a signed JWT by posting admin credentials to the login endpoint. The token is
              valid for 24 hours and must be sent as a Bearer header on every subsequent request.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="POST" path="/api/auth/login" description="Authenticate and receive a JWT" />
              <EndpointRow method="GET" path="/api/auth/me" description="Return the currently authenticated user" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Login Request</p>
              <CodeBlock
                code={`curl -X POST https://your-domain.com/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "admin@rasokart.com", "password": "Admin@123456"}'`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Login Response</p>
              <CodeBlock
                language="json"
                code={`{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "admin@rasokart.com",
    "role": "admin",
    "name": "Admin"
  }
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="POST"
                path="/api/auth/login"
                token=""
                requiresAuth={false}
                defaultBody={`{
  "email": "admin@rasokart.com",
  "password": "Admin@123456"
}`}
                expectedBodyKeys={[
                  { key: "email", type: "string" },
                  { key: "password", type: "string" },
                ]}
              />
              <TryItPanel
                method="GET"
                path="/api/auth/me"
                token={globalToken}
              />
            </div>
          </Section>

          {/* ── Merchants ──────────────────────────────────────────────────── */}
          <Section title="Merchants" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Full merchant lifecycle management — list, inspect, suspend, reinstate, and assign
              plans.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/merchants" description="List all merchants (paginated, filterable)" />
              <EndpointRow method="GET" path="/api/merchants/{id}" description="Get a single merchant's full profile" />
              <EndpointRow method="PUT" path="/api/merchants/{id}" description="Update merchant details" />
              <EndpointRow method="POST" path="/api/merchants/{id}/suspend" description="Suspend a merchant account" />
              <EndpointRow method="POST" path="/api/merchants/{id}/reinstate" description="Reinstate a suspended merchant" />
              <EndpointRow method="PUT" path="/api/merchants/{id}/plan" description="Assign or change a merchant's plan" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">List Merchants — Query Params</p>
              <CodeBlock
                language="json"
                code={`GET /api/merchants?page=1&limit=20&search=acme&status=active&plan=gold`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Assign Plan — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "planId": 3,
  "note": "Upgraded by ops team per request #1042"
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/merchants"
                token={globalToken}
                commonQueryParams={["page", "limit", "search", "status", "plan"]}
              />
              <TryItPanel
                method="GET"
                path="/api/merchants/{id}"
                token={globalToken}
              />
              <TryItPanel
                method="POST"
                path="/api/merchants/{id}/suspend"
                token={globalToken}
                defaultBody={`{
  "reason": "Policy violation"
}`}
                expectedBodyKeys={[{ key: "reason", type: "string" }]}
              />
              <TryItPanel
                method="POST"
                path="/api/merchants/{id}/reinstate"
                token={globalToken}
                defaultBody={`{}`}
              />
              <TryItPanel
                method="PUT"
                path="/api/merchants/{id}/plan"
                token={globalToken}
                defaultBody={`{
  "planId": 3,
  "note": "Upgraded by ops team"
}`}
                expectedBodyKeys={[
                  { key: "planId", type: "integer" },
                  { key: "note", type: "string" },
                ]}
              />
            </div>
          </Section>

          {/* ── Deposits ───────────────────────────────────────────────────── */}
          <Section title="Deposits" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              View and manage all merchant deposits across the platform.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/deposits" description="List all deposits (all merchants)" />
              <EndpointRow method="GET" path="/api/deposits/{id}" description="Get a single deposit record" />
              <EndpointRow method="PUT" path="/api/deposits/{id}" description="Update deposit status or metadata" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">List Deposits — Query Params</p>
              <CodeBlock
                language="json"
                code={`GET /api/deposits?page=1&limit=20&merchantId=5&status=pending&from=2026-01-01&to=2026-07-01`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/deposits"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "from", "to", "search"]}
              />
              <TryItPanel
                method="GET"
                path="/api/deposits/{id}"
                token={globalToken}
              />
            </div>
          </Section>

          {/* ── Settlements ────────────────────────────────────────────────── */}
          <Section title="Settlements" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Review, approve, reject, and manage settlement requests from merchants.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/settlements" description="List all settlement requests" />
              <EndpointRow method="GET" path="/api/settlements/{id}" description="Get a single settlement" />
              <EndpointRow method="POST" path="/api/settlements/{id}/approve" description="Approve a pending settlement" />
              <EndpointRow method="POST" path="/api/settlements/{id}/reject" description="Reject a pending settlement" />
              <EndpointRow method="POST" path="/api/settlements/{id}/hold" description="Place a settlement on hold" />
              <EndpointRow method="POST" path="/api/settlements/{id}/mark-paid" description="Mark a settlement as paid" />
              <EndpointRow method="GET" path="/api/settlements/stats" description="Settlement aggregate stats" />
              <EndpointRow method="GET" path="/api/settlements/export/csv" description="Export settlements to CSV" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Approve — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "note": "Approved — standard 3-day cycle",
  "utrNumber": "UTR123456789012"
}`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Reject — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "reason": "Insufficient balance in float account"
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/settlements"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "from", "to"]}
              />
              <TryItPanel
                method="GET"
                path="/api/settlements/{id}"
                token={globalToken}
              />
              <TryItPanel
                method="POST"
                path="/api/settlements/{id}/approve"
                token={globalToken}
                defaultBody={`{
  "note": "Approved — standard cycle",
  "utrNumber": ""
}`}
                expectedBodyKeys={[
                  { key: "note", type: "string" },
                  { key: "utrNumber", type: "string" },
                ]}
              />
              <TryItPanel
                method="POST"
                path="/api/settlements/{id}/reject"
                token={globalToken}
                defaultBody={`{
  "reason": "Insufficient float balance"
}`}
                expectedBodyKeys={[{ key: "reason", type: "string" }]}
              />
              <TryItPanel
                method="GET"
                path="/api/settlements/stats"
                token={globalToken}
              />
            </div>
          </Section>

          {/* ── Transactions ───────────────────────────────────────────────── */}
          <Section title="Transactions" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Browse and update payment transactions across all merchants.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/transactions" description="List all transactions (all merchants)" />
              <EndpointRow method="GET" path="/api/transactions/{id}" description="Get a single transaction" />
              <EndpointRow method="PUT" path="/api/transactions/{id}" description="Update transaction status or metadata (admin)" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">List Transactions — Query Params</p>
              <CodeBlock
                language="json"
                code={`GET /api/transactions?page=1&limit=20&merchantId=5&status=success&from=2026-01-01&to=2026-07-01`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/transactions"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "from", "to", "search", "utr"]}
              />
              <TryItPanel
                method="GET"
                path="/api/transactions/{id}"
                token={globalToken}
              />
              <TryItPanel
                method="PUT"
                path="/api/transactions/{id}"
                token={globalToken}
                defaultBody={`{
  "status": "success",
  "adminNote": "Manually reconciled"
}`}
                expectedBodyKeys={[
                  { key: "status", type: "string" },
                  { key: "adminNote", type: "string" },
                ]}
              />
            </div>
          </Section>

          {/* ── Payouts ────────────────────────────────────────────────────── */}
          <Section title="Payouts" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Manage merchant payout requests — approve, reject, or retry failed transfers.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/payout-beneficiaries" description="List all payout beneficiaries" />
              <EndpointRow method="GET" path="/api/payout-beneficiaries/{id}" description="Get a single beneficiary" />
              <EndpointRow method="POST" path="/api/payout-beneficiaries/{id}/approve" description="Approve a pending payout" />
              <EndpointRow method="POST" path="/api/payout-beneficiaries/{id}/reject" description="Reject a payout" />
              <EndpointRow method="POST" path="/api/payout-beneficiaries/{id}/retry" description="Retry a failed payout" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Approve Payout — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "note": "Verified — sending via Cashfree"
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/payout-beneficiaries"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "from", "to"]}
              />
              <TryItPanel
                method="GET"
                path="/api/payout-beneficiaries/{id}"
                token={globalToken}
              />
              <TryItPanel
                method="POST"
                path="/api/payout-beneficiaries/{id}/approve"
                token={globalToken}
                defaultBody={`{
  "note": "Verified — sending via provider"
}`}
                expectedBodyKeys={[{ key: "note", type: "string" }]}
              />
              <TryItPanel
                method="POST"
                path="/api/payout-beneficiaries/{id}/reject"
                token={globalToken}
                defaultBody={`{
  "reason": "Beneficiary details mismatch"
}`}
                expectedBodyKeys={[{ key: "reason", type: "string" }]}
              />
              <TryItPanel
                method="POST"
                path="/api/payout-beneficiaries/{id}/retry"
                token={globalToken}
                defaultBody={`{}`}
              />
            </div>
          </Section>

          {/* ── Reconciliation ─────────────────────────────────────────────── */}
          <Section title="Reconciliation" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Match deposits against settlements, inspect unmatched entries, and manage the
              reconciliation engine.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/reconciliation" description="List reconciliation records (matched + unmatched)" />
              <EndpointRow method="POST" path="/api/reconciliation/match" description="Manually match a deposit to a settlement" />
              <EndpointRow method="DELETE" path="/api/reconciliation/match/{id}" description="Unmatch a previously matched pair" />
              <EndpointRow method="POST" path="/api/reconciliation/auto-match" description="Trigger automated greedy matching" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Manual Match — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "depositId": 101,
  "settlementId": 42
}`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">List — Query Params</p>
              <CodeBlock
                language="json"
                code={`GET /api/reconciliation?status=unmatched&merchantId=5&from=2026-01-01&to=2026-07-01`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/reconciliation"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "from", "to"]}
              />
              <TryItPanel
                method="POST"
                path="/api/reconciliation/match"
                token={globalToken}
                defaultBody={`{
  "depositId": 0,
  "settlementId": 0
}`}
                expectedBodyKeys={[
                  { key: "depositId", type: "integer" },
                  { key: "settlementId", type: "integer" },
                ]}
              />
              <TryItPanel
                method="DELETE"
                path="/api/reconciliation/match/{id}"
                token={globalToken}
              />
              <TryItPanel
                method="POST"
                path="/api/reconciliation/auto-match"
                token={globalToken}
                defaultBody={`{
  "merchantId": null
}`}
                expectedBodyKeys={[{ key: "merchantId", type: "integer" }]}
              />
            </div>
          </Section>

          {/* ── Smart Routing ──────────────────────────────────────────────── */}
          <Section title="Smart Routing" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Configure failover strategies, manage provider rules, inspect routing decision
              logs, and dry-run the failover chain for a given amount/payment mode.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/smart-routing/configs" description="List routing configs" />
              <EndpointRow method="POST" path="/api/smart-routing/configs" description="Create a routing config" />
              <EndpointRow method="PUT" path="/api/smart-routing/configs/{id}" description="Update a routing config" />
              <EndpointRow method="GET" path="/api/smart-routing/configs/{id}/rules" description="List rules for a config" />
              <EndpointRow method="POST" path="/api/smart-routing/configs/{id}/rules" description="Add a rule to a config" />
              <EndpointRow method="PUT" path="/api/smart-routing/rules/{id}" description="Update a rule" />
              <EndpointRow method="DELETE" path="/api/smart-routing/rules/{id}" description="Delete a rule" />
              <EndpointRow method="GET" path="/api/smart-routing/metrics" description="Provider success-rate metrics" />
              <EndpointRow method="GET" path="/api/smart-routing/logs" description="Routing decision logs" />
              <EndpointRow method="GET" path="/api/smart-routing/simulate" description="Dry-run the failover chain (no real calls made)" />
              <EndpointRow method="GET" path="/api/smart-routing/status" description="Smart routing health summary" />
              <EndpointRow method="GET" path="/api/smart-routing/failover-events" description="Chain-exhaustion (failover) events" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Simulate — CI/CD failover check
              </p>
              <p className="text-sm text-muted-foreground mb-2">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">GET /api/smart-routing/simulate</code>{" "}
                returns a top-level <code className="text-xs bg-muted px-1.5 py-0.5 rounded">wouldFail</code> boolean —{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">true</code> when the current routing config
                would leave zero viable providers for the given amount/payment mode (no matching rules, or every
                matching rule is Fallback Only). Wire this into a pipeline check to catch a bad routing config
                change before it reaches production:
              </p>
              <CodeBlock
                code={`curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \\
  "$API_BASE/api/smart-routing/simulate?amount=1000&paymentMode=upi" \\
  | jq -e '.wouldFail == false'

# Exit code is non-zero when wouldFail is true — fail the pipeline on that.`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/smart-routing/simulate"
                token={globalToken}
                commonQueryParams={["amount", "paymentMode", "configName"]}
              />
            </div>
          </Section>

          {/* ── Plans ──────────────────────────────────────────────────────── */}
          <Section title="Plans" badge="4 endpoints">
            <p className="text-sm text-muted-foreground">
              Manage subscription plans and inspect plan usage across merchants.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/plans" description="List all available plans" />
              <EndpointRow method="POST" path="/api/plans" description="Create a new plan" />
              <EndpointRow method="PUT" path="/api/plans/{id}" description="Update plan details or pricing" />
              <EndpointRow method="DELETE" path="/api/plans/{id}" description="Delete a plan (only if no active subscribers)" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Create Plan — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "name": "Enterprise",
  "price": "9999.00",
  "billingCycle": "monthly",
  "maxQrCodes": 500,
  "maxVirtualAccounts": 100,
  "apiAccess": true,
  "webhookAccess": true
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/plans"
                token={globalToken}
              />
              <TryItPanel
                method="POST"
                path="/api/plans"
                token={globalToken}
                defaultBody={`{
  "name": "Enterprise",
  "price": "9999.00",
  "billingCycle": "monthly",
  "maxQrCodes": 500,
  "maxVirtualAccounts": 100,
  "apiAccess": true,
  "webhookAccess": true
}`}
                expectedBodyKeys={[
                  { key: "name", type: "string" },
                  { key: "price", type: "string" },
                  { key: "billingCycle", type: "string" },
                  { key: "maxQrCodes", type: "integer" },
                  { key: "maxVirtualAccounts", type: "integer" },
                  { key: "apiAccess", type: "boolean" },
                  { key: "webhookAccess", type: "boolean" },
                ]}
              />
              <TryItPanel
                method="PUT"
                path="/api/plans/{id}"
                token={globalToken}
                defaultBody={`{
  "price": "11999.00"
}`}
                expectedBodyKeys={[{ key: "price", type: "string" }]}
              />
            </div>
          </Section>

          {/* ── Invoices ───────────────────────────────────────────────────── */}
          <Section title="Invoices" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Browse and manage plan invoices generated when merchants are assigned or renewed on a
              plan.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/invoices" description="List all invoices across merchants" />
              <EndpointRow method="GET" path="/api/invoices/{id}" description="Get a single invoice" />
              <EndpointRow method="PUT" path="/api/invoices/{id}" description="Update invoice status or metadata" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/invoices"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "from", "to"]}
              />
              <TryItPanel
                method="GET"
                path="/api/invoices/{id}"
                token={globalToken}
              />
            </div>
          </Section>

          {/* ── Balance Ledger ─────────────────────────────────────────────── */}
          <Section title="Balance Ledger" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Query ledger entries for any merchant — credits, debits, running balances, and
              reconciliation anchors.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/ledger" description="List ledger entries (merchant-scoped or admin-all)" />
              <EndpointRow method="GET" path="/api/ledger/summary" description="Balance summary for a merchant" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">List Ledger — Query Params</p>
              <CodeBlock
                language="json"
                code={`GET /api/ledger?merchantId=5&type=credit&from=2026-01-01&to=2026-07-01&page=1&limit=50`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/ledger"
                token={globalToken}
                commonQueryParams={["merchantId", "page", "limit", "type", "from", "to"]}
              />
            </div>
          </Section>

          {/* ── Wallets ────────────────────────────────────────────────────── */}
          <Section title="Wallets" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              View and adjust merchant wallet balances. Manual adjustments are logged to the audit
              trail.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/wallets" description="List all merchant wallets" />
              <EndpointRow method="GET" path="/api/wallets/{merchantId}" description="Get wallet for a specific merchant" />
              <EndpointRow method="POST" path="/api/wallets/{merchantId}/adjust" description="Manually credit or debit a wallet" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Adjust Wallet — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "amount": "500.00",
  "type": "credit",
  "note": "Manual correction for missing deposit #1042"
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/wallets"
                token={globalToken}
                commonQueryParams={["page", "limit", "search"]}
              />
              <TryItPanel
                method="GET"
                path="/api/wallets/{merchantId}"
                token={globalToken}
              />
              <TryItPanel
                method="POST"
                path="/api/wallets/{merchantId}/adjust"
                token={globalToken}
                defaultBody={`{
  "amount": "0.00",
  "type": "credit",
  "note": ""
}`}
                expectedBodyKeys={[
                  { key: "amount", type: "string" },
                  { key: "type", type: "string" },
                  { key: "note", type: "string" },
                ]}
              />
            </div>
          </Section>

          {/* ── Audit Logs ─────────────────────────────────────────────────── */}
          <Section title="Audit Logs" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Immutable record of every admin action — merchant changes, plan assignments,
              settlements, configuration updates, and user management events.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/audit-logs" description="List audit log entries (newest first)" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Query Params</p>
              <CodeBlock
                language="json"
                code={`GET /api/audit-logs?page=1&limit=50&action=merchant.suspend&merchantId=5&adminId=1&from=2026-01-01`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/audit-logs"
                token={globalToken}
                commonQueryParams={["page", "limit", "action", "merchantId", "adminId", "from", "to"]}
              />
            </div>
          </Section>

          {/* ── QR Codes ───────────────────────────────────────────────────── */}
          <Section title="QR Codes" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Inspect and manage QR codes across all merchants from the admin portal.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/qr-codes" description="List all QR codes (all merchants when admin token)" />
              <EndpointRow method="GET" path="/api/qr-codes/{id}" description="Get a single QR code" />
              <EndpointRow method="PUT" path="/api/qr-codes/{id}" description="Update QR code status or label" />
              <EndpointRow method="DELETE" path="/api/qr-codes/{id}" description="Delete a QR code" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/qr-codes"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "search", "type", "status"]}
              />
              <TryItPanel
                method="GET"
                path="/api/qr-codes/{id}"
                token={globalToken}
              />
              <TryItPanel
                method="PUT"
                path="/api/qr-codes/{id}"
                token={globalToken}
                defaultBody={`{
  "status": "inactive",
  "label": "Updated label"
}`}
                expectedBodyKeys={[
                  { key: "status", type: "string" },
                  { key: "label", type: "string" },
                ]}
              />
            </div>
          </Section>

          {/* ── Virtual Accounts ───────────────────────────────────────────── */}
          <Section title="Virtual Accounts" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Inspect virtual UPI accounts assigned to merchants across the platform.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/virtual-accounts" description="List all virtual accounts" />
              <EndpointRow method="GET" path="/api/virtual-accounts/{id}" description="Get a single virtual account" />
              <EndpointRow method="PUT" path="/api/virtual-accounts/{id}" description="Update virtual account status or config" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/virtual-accounts"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "search"]}
              />
              <TryItPanel
                method="GET"
                path="/api/virtual-accounts/{id}"
                token={globalToken}
              />
            </div>
          </Section>

          {/* ── API Monitoring ─────────────────────────────────────────────── */}
          <Section title="API Monitoring" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Platform-wide API usage statistics and request logs for monitoring traffic, latency,
              and error rates.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/api-monitoring" description="List API request logs with status codes and latency" />
              <EndpointRow method="GET" path="/api/api-monitoring/stats" description="Aggregate stats (total requests, p95 latency, error rate)" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/api-monitoring"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "status", "path", "from", "to"]}
              />
              <TryItPanel
                method="GET"
                path="/api/api-monitoring/stats"
                token={globalToken}
                commonQueryParams={["merchantId", "from", "to"]}
              />
            </div>
          </Section>

          {/* ── Notifications ──────────────────────────────────────────────── */}
          <Section title="Notifications" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Create and broadcast admin notifications to merchants, and inspect notification
              delivery status.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/notifications" description="List notifications (admin sees all)" />
              <EndpointRow method="POST" path="/api/notifications" description="Create a notification or broadcast" />
              <EndpointRow method="DELETE" path="/api/notifications/{id}" description="Delete a notification" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Create Broadcast — Request Body</p>
              <CodeBlock
                language="json"
                code={`{
  "type": "info",
  "title": "Platform maintenance scheduled",
  "message": "The platform will be briefly unavailable on 2026-07-15 at 02:00 IST.",
  "merchantIds": null
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/notifications"
                token={globalToken}
                commonQueryParams={["page", "limit", "merchantId", "type", "isRead"]}
              />
              <TryItPanel
                method="POST"
                path="/api/notifications"
                token={globalToken}
                defaultBody={`{
  "type": "info",
  "title": "",
  "message": "",
  "merchantIds": null
}`}
                expectedBodyKeys={[
                  { key: "type", type: "string" },
                  { key: "title", type: "string" },
                  { key: "message", type: "string" },
                  { key: "merchantIds", type: "array" },
                ]}
              />
            </div>
          </Section>

          {/* ── Health ─────────────────────────────────────────────────────── */}
          <Section title="Health" badge="public">
            <p className="text-sm text-muted-foreground">
              Liveness and readiness probes. The deep check verifies DB connectivity and validates
              demo credentials — used as the startup health gate in production.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/healthz" description="Shallow ping — returns 200 if the process is up" />
              <EndpointRow method="GET" path="/api/healthz/deep" description="Deep check — verifies DB, demo credentials, and seed state" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Shallow Response</p>
              <CodeBlock
                language="json"
                code={`{ "status": "ok", "timestamp": "2026-07-08T10:00:00.000Z" }`}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Deep Response (healthy)</p>
              <CodeBlock
                language="json"
                code={`{
  "status": "ok",
  "db": "ok",
  "demo_credentials": "ok",
  "timestamp": "2026-07-08T10:00:00.000Z"
}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/healthz"
                token={globalToken}
                requiresAuth={false}
              />
              <TryItPanel
                method="GET"
                path="/api/healthz/deep"
                token={globalToken}
                requiresAuth={false}
              />
            </div>
          </Section>

          {/* ── Feature Control ────────────────────────────────────────────── */}
          <Section title="Feature Control & Settings" badge="admin-only">
            <p className="text-sm text-muted-foreground">
              Toggle platform-wide feature flags, module visibility, and global settings. Changes
              take effect immediately without a deploy.
            </p>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
              <EndpointRow method="GET" path="/api/feature-control" description="List all feature flags and their current state" />
              <EndpointRow method="PUT" path="/api/feature-control/{key}" description="Enable or disable a feature flag" />
              <EndpointRow method="GET" path="/api/module-control" description="List all module visibility settings" />
              <EndpointRow method="PUT" path="/api/module-control/{module}" description="Toggle a module on or off" />
              <EndpointRow method="GET" path="/api/settings" description="Get global platform settings" />
              <EndpointRow method="PUT" path="/api/settings" description="Update global platform settings" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Try it</p>
              <TryItPanel
                method="GET"
                path="/api/feature-control"
                token={globalToken}
              />
              <TryItPanel
                method="PUT"
                path="/api/feature-control/{key}"
                token={globalToken}
                defaultBody={`{
  "enabled": true
}`}
                expectedBodyKeys={[{ key: "enabled", type: "boolean" }]}
              />
              <TryItPanel
                method="GET"
                path="/api/settings"
                token={globalToken}
              />
              <TryItPanel
                method="PUT"
                path="/api/settings"
                token={globalToken}
                defaultBody={`{
  "minSettlementAmount": "500.00"
}`}
                expectedBodyKeys={[{ key: "minSettlementAmount", type: "string" }]}
              />
            </div>
          </Section>

        </div>
      </div>
    </SharedPresetContext.Provider>
  );
}
