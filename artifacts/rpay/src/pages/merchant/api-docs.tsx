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

function collectCredentialWarnings(
  queryParams: { key: string; value: string }[],
  body: string,
  pathValues: Record<string, string>
): string[] {
  const warnings: string[] = [];
  for (const row of queryParams) {
    if (row.key.trim() && looksLikeCredential(row.value)) {
      warnings.push(`query param "${row.key}"`);
    }
  }
  for (const [key, val] of Object.entries(pathValues)) {
    if (looksLikeCredential(val)) {
      warnings.push(`path param "{${key}}"`);
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

interface SavedQueryPreset {
  id: string;
  name: string;
  pathValues: Record<string, string>;
  queryParams: { key: string; value: string }[];
  body: string;
}

const TRY_IT_PRESETS_STORAGE_KEY = "rasokart_tryit_presets";

function presetsStorageKeyFor(method: string, path: string): string {
  return `${method} ${path}`;
}

const PRESETS_CHANGED_EVENT = "rasokart-tryit-presets-changed";

function dispatchPresetsChanged() {
  try {
    window.dispatchEvent(new Event(PRESETS_CHANGED_EVENT));
  } catch {
    // non-fatal — cross-panel sync just won't fire this time
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

function saveAllPresets(all: Record<string, SavedQueryPreset[]>) {
  try {
    localStorage.setItem(TRY_IT_PRESETS_STORAGE_KEY, JSON.stringify(all));
    dispatchPresetsChanged();
  } catch {
    // localStorage may be unavailable (e.g. private browsing) — presets simply won't persist
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
  /** Per-panel bearer token — only present when the sharer explicitly unchecked "Strip auth token". */
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
    // ignore — non-fatal if the URL can't be rewritten
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
  // If the sharer explicitly included their token (stripToken was unchecked), hydrate it.
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

  const addQueryParam = useCallback((prefillKey = "") => {
    setQueryParams((prev) => [...prev, { id: ++queryParamRowId, key: prefillKey, value: "" }]);
  }, []);

  const updateQueryParam = useCallback((id: number, field: "key" | "value", value: string) => {
    setQueryParams((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }, []);

  const removeQueryParam = useCallback((id: number) => {
    setQueryParams((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const handleAddCommonParam = useCallback(
    (key: string) => {
      setQueryParams((prev) => {
        if (prev.some((row) => row.key === key)) return prev;
        return [...prev, { id: ++queryParamRowId, key, value: "" }];
      });
    },
    []
  );

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const filteredParams = queryParams.filter((row) => row.key.trim().length > 0);
    const warnings = collectCredentialWarnings(
      filteredParams.map((row) => ({ key: row.key, value: row.value })),
      body,
      pathValues
    );
    setPresetCredentialWarnings(warnings);
    const newPreset: SavedQueryPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      pathValues: { ...pathValues },
      queryParams: filteredParams.map((row) => ({ key: row.key, value: row.value })),
      body,
    };
    setPresets((prev) => {
      const next = [...prev.filter((p) => p.name !== name), newPreset];
      persistPresetsForEndpoint(method, path, next);
      return next;
    });
    setPresetName("");
    toast.success(`Saved preset "${name}"`);
  }, [presetName, pathValues, queryParams, body, method, path]);

  const handleLoadPreset = useCallback((preset: SavedQueryPreset) => {
    setPathValues({ ...preset.pathValues });
    setQueryParams(
      preset.queryParams.map((row) => ({ id: ++queryParamRowId, key: row.key, value: row.value }))
    );
    setBody(preset.body);
    toast.success(`Loaded preset "${preset.name}"`);
  }, []);

  const handleDeletePreset = useCallback(
    (id: string) => {
      setPresets((prev) => {
        const next = prev.filter((p) => p.id !== id);
        persistPresetsForEndpoint(method, path, next);
        return next;
      });
    },
    [method, path]
  );

  const queryString = queryParams
    .filter((row) => row.key.trim().length > 0)
    .map((row) => `${encodeURIComponent(row.key.trim())}=${encodeURIComponent(row.value)}`)
    .join("&");

  const resolvedPath = path.replace(/\{(\w+)\}/g, (_, key) => pathValues[key] ?? `{${key}}`);
  const baseUrl = window.location.origin;
  const url = `${baseUrl}${resolvedPath}${queryString ? `?${queryString}` : ""}`;

  const buildCurlCommand = useCallback(() => {
    const activeToken = requiresAuth ? (localToken || token) : "";
    const parts = [`curl -X ${method} '${url}'`];
    if (activeToken) {
      parts.push(`  -H 'Authorization: Bearer ${activeToken}'`);
    }
    if (hasBody) {
      parts.push(`  -H 'Content-Type: application/json'`);
      if (body.trim()) {
        const escapedBody = body.replace(/'/g, `'\\''`);
        parts.push(`  -d '${escapedBody}'`);
      }
    }
    return parts.join(" \\\n");
  }, [method, url, hasBody, body, localToken, token, requiresAuth]);

  const handleCopyCurl = useCallback(() => {
    const curl = buildCurlCommand();
    navigator.clipboard.writeText(curl);
    setCurlCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCurlCopied(false), 2000);
  }, [buildCurlCommand]);

  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [showShareWarning, setShowShareWarning] = useState(false);
  const [pendingShareExpiry, setPendingShareExpiry] = useState<number | null>(null);
  const [shareCredentialWarnings, setShareCredentialWarnings] = useState<string[]>([]);
  const [presetCredentialWarnings, setPresetCredentialWarnings] = useState<string[]>([]);
  // Checked by default — omits the per-panel bearer token from the encoded URL to prevent
  // accidental credential leakage. The page-level "Shared Bearer Token" field is never
  // included in share links regardless of this setting.
  const [stripToken, setStripToken] = useState(true);

  const doShare = useCallback((expiryMinutes: number | null, shouldStripToken: boolean) => {
    const expiresAt =
      expiryMinutes != null
        ? new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()
        : undefined;
    const shareUrl = buildSharedPresetUrl({
      method,
      path,
      pathValues: { ...pathValues },
      queryParams: queryParams
        .filter((row) => row.key.trim().length > 0)
        .map((row) => ({ key: row.key, value: row.value })),
      body,
      expiresAt,
      // Only embed the per-panel token when the user explicitly unchecked "Strip auth token".
      localToken: shouldStripToken ? undefined : (localToken || undefined),
    });
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setSharePopoverOpen(false);
    const label = expiryMinutes != null
      ? EXPIRY_OPTIONS.find((o) => o.minutes === expiryMinutes)?.label ?? "custom expiry"
      : "no expiry";
    toast.success(`Share link copied (${label}) — opening it pre-loads this exact request`);
    setTimeout(() => setShareCopied(false), 2000);
  }, [method, path, pathValues, queryParams, body, localToken]);

  const handleShare = useCallback((expiryMinutes: number | null) => {
    const filteredParams = queryParams
      .filter((row) => row.key.trim().length > 0)
      .map((row) => ({ key: row.key, value: row.value }));
    const warnings = collectCredentialWarnings(filteredParams, body, pathValues);
    if (warnings.length > 0) {
      setShareCredentialWarnings(warnings);
      setPendingShareExpiry(expiryMinutes);
      setSharePopoverOpen(false);
      setShowShareWarning(true);
      return;
    }
    doShare(expiryMinutes, stripToken);
  }, [queryParams, body, pathValues, doShare, stripToken]);

  const handleCopyAllHeaders = useCallback(() => {
    if (!response) return;
    const text = Object.entries(response.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setHeadersCopied(true);
    toast.success("Headers copied to clipboard");
    setTimeout(() => setHeadersCopied(false), 2000);
  }, [response]);

  const handleCopyHeader = useCallback((key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedHeaderKey(key);
    toast.success(`Copied ${key}`);
    setTimeout(() => setCopiedHeaderKey((cur) => (cur === key ? null : cur)), 2000);
  }, []);

  const fire = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = {};
      const activeToken = requiresAuth ? (localToken || token) : undefined;
      if (activeToken) headers["Authorization"] = `Bearer ${activeToken}`;
      if (hasBody) headers["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method,
        headers,
        body: hasBody && body.trim() ? body : undefined,
      });

      let text = "";
      try {
        const json = await res.json();
        text = JSON.stringify(json, null, 2);
      } catch {
        text = await res.text();
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: text,
        durationMs: Date.now() - t0,
        headers: responseHeaders,
      });
    } catch (err: unknown) {
      setResponse({
        status: 0,
        statusText: "Network Error",
        body: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
        headers: {},
      });
    } finally {
      setLoading(false);
    }
  }, [url, method, body, localToken, token, hasBody, requiresAuth]);

  const statusColor =
    response == null
      ? ""
      : response.status >= 200 && response.status < 300
      ? "text-emerald-400"
      : response.status >= 400
      ? "text-rose-400"
      : "text-yellow-400";

  const methodColors: Record<string, string> = {
    GET: "border-blue-500/40 bg-blue-500/5",
    POST: "border-emerald-500/40 bg-emerald-500/5",
    PUT: "border-yellow-500/40 bg-yellow-500/5",
    DELETE: "border-rose-500/40 bg-rose-500/5",
  };

  return (
    <div
      ref={panelRef}
      className={`rounded-lg border ${methodColors[method] ?? "border-border/50"} overflow-hidden ${
        sharedMatch ? "ring-1 ring-primary/60" : ""
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">Try it</span>
        <span className="text-xs font-mono text-foreground/70 truncate flex-1">
          {method} {path}
        </span>
        {sharedMatch && (
          <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30 shrink-0">
            From shared link
          </Badge>
        )}
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/30 pt-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Saved Presets</Label>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border border-border/50 bg-black/30 text-[11px]"
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
                placeholder="Preset name (e.g. This week, provider X)"
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
                  Preset saved — but {presetCredentialWarnings.length === 1 ? (
                    <span className="font-mono">{presetCredentialWarnings[0]}</span>
                  ) : (
                    presetCredentialWarnings.map((w, i) => (
                      <span key={w}>
                        {i > 0 && (i === presetCredentialWarnings.length - 1 ? " and " : ", ")}
                        <span className="font-mono">{w}</span>
                      </span>
                    ))
                  )}{" "}
                  look{presetCredentialWarnings.length === 1 ? "s" : ""} like a token or API key. Presets are stored in localStorage and visible to any script on this origin.
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
                placeholder="Paste your JWT token here"
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
                            "{row.key.trim()}" isn't a documented param for this endpoint — it may be ignored by
                            the server (undocumented params are still sent).
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
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className={`text-xs font-mono bg-black/40 resize-y ${
                  unknownBodyKeys.length > 0 || typeMismatches.length > 0
                    ? "border-amber-500/50 focus-visible:ring-amber-500/30"
                    : ""
                }`}
                spellCheck={false}
              />
              {unknownBodyKeys.length > 0 && (
                <p className="text-[10px] text-amber-500/80 pl-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                  {unknownBodyKeys.length === 1
                    ? `"${unknownBodyKeys[0]}" isn't a documented field for this endpoint`
                    : `${unknownBodyKeys.map((key) => `"${key}"`).join(", ")} aren't documented fields for this endpoint`}
                  {" "}— it may be ignored by the server (undocumented fields are still sent).
                </p>
              )}
              {typeMismatches.map((m) => (
                <p key={m.key} className="text-[10px] text-amber-500/80 pl-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                  <span>
                    <span className="font-mono">"{m.key}"</span>
                    {" "}should be a <span className="font-mono">{m.expected}</span>, but got a <span className="font-mono">{m.actual}</span> — the request will still be sent.
                  </span>
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={fire}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
              {loading ? "Sending…" : "Send Request"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={handleCopyCurl}
            >
              {curlCopied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {curlCopied ? "Copied!" : "Copy as cURL"}
            </Button>
            <Popover open={sharePopoverOpen} onOpenChange={setSharePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                >
                  {shareCopied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Share2 className="w-3 h-3" />
                  )}
                  {shareCopied ? "Link copied!" : "Share"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <label className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded cursor-pointer hover:bg-accent/60 transition-colors">
                  <input
                    type="checkbox"
                    checked={stripToken}
                    onChange={(e) => setStripToken(e.target.checked)}
                    className="accent-primary w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-xs font-medium">Strip auth token</span>
                  <ShieldCheck className={`w-3 h-3 shrink-0 ml-auto ${stripToken ? "text-emerald-400" : "text-muted-foreground"}`} />
                </label>
                {!stripToken && (
                  <p className="text-[10px] text-amber-400/80 px-2 pb-1.5 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    Bearer token will be embedded in the URL — only share with trusted recipients.
                  </p>
                )}
                <div className="border-t border-border/30 my-1" />
                <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                  Link expires in…
                </p>
                {sharedMatch?.expiresAt && (
                  <p className="text-[11px] text-amber-400/80 px-2 pb-1.5 flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    Original expires in {formatRemainingTime(sharedMatch.expiresAt)}
                  </p>
                )}
                {EXPIRY_OPTIONS.map((opt) => {
                  const isSuggested =
                    suggestedExpiryMinutes != null && opt.minutes === suggestedExpiryMinutes;
                  return (
                    <button
                      key={opt.label}
                      className={`flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left${isSuggested ? " bg-accent/50 font-medium" : ""}`}
                      onClick={() => handleShare(opt.minutes)}
                    >
                      {opt.minutes == null ? (
                        <LinkIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                      ) : (
                        <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      {opt.label}
                      {isSuggested && (
                        <span className="ml-auto text-[10px] text-amber-400/80 font-normal shrink-0">
                          suggested
                        </span>
                      )}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground font-mono truncate">{url}</span>
          </div>

          {response && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-bold font-mono ${statusColor}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-muted-foreground">{response.durationMs}ms</span>
              </div>
              <Tabs defaultValue="body">
                <TabsList className="h-7">
                  <TabsTrigger value="body" className="h-5 text-[11px] px-2 py-0">
                    Body
                  </TabsTrigger>
                  <TabsTrigger value="headers" className="h-5 text-[11px] px-2 py-0">
                    Headers
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="body" className="mt-1.5">
                  <pre className="bg-black/60 border border-border/50 rounded-lg p-3 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap max-h-72">
                    {typeof response.body === "string" ? response.body : JSON.stringify(response.body, null, 2)}
                  </pre>
                </TabsContent>
                <TabsContent value="headers" className="mt-1.5">
                  {Object.keys(response.headers).length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] gap-1"
                          onClick={handleCopyAllHeaders}
                        >
                          {headersCopied ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {headersCopied ? "Copied!" : "Copy all headers"}
                        </Button>
                      </div>
                      <div className="bg-black/60 border border-border/50 rounded-lg p-3 max-h-72 overflow-y-auto">
                        {Object.entries(response.headers).map(([key, value]) => (
                          <div
                            key={key}
                            className="group flex items-start justify-between gap-2 py-0.5 text-xs font-mono text-green-300"
                          >
                            <span className="break-all whitespace-pre-wrap">
                              {key}: {value}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleCopyHeader(key, value)}
                            >
                              {copiedHeaderKey === key ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <pre className="bg-black/60 border border-border/50 rounded-lg p-3 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap max-h-72">
                      No response headers
                    </pre>
                  )}
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
                doShare(pendingShareExpiry, stripToken);
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

interface PresetsExportFile {
  version: 1;
  exportedAt: string;
  presets: Record<string, SavedQueryPreset[]>;
}

function isValidSavedQueryPreset(v: unknown): v is SavedQueryPreset {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p["id"] === "string" &&
    typeof p["name"] === "string" &&
    typeof p["body"] === "string" &&
    p["pathValues"] !== null &&
    typeof p["pathValues"] === "object" &&
    !Array.isArray(p["pathValues"]) &&
    Array.isArray(p["queryParams"]) &&
    (p["queryParams"] as unknown[]).every(
      (row) =>
        row !== null &&
        typeof row === "object" &&
        typeof (row as Record<string, unknown>)["key"] === "string" &&
        typeof (row as Record<string, unknown>)["value"] === "string"
    )
  );
}

function parsePresetsExportFile(raw: string): PresetsExportFile | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (obj["version"] !== 1) return null;
    if (typeof obj["exportedAt"] !== "string") return null;
    if (!obj["presets"] || typeof obj["presets"] !== "object" || Array.isArray(obj["presets"])) return null;
    const presets = obj["presets"] as Record<string, unknown>;
    for (const key of Object.keys(presets)) {
      const arr = presets[key];
      if (!Array.isArray(arr)) return null;
      if (!arr.every(isValidSavedQueryPreset)) return null;
    }
    return {
      version: 1,
      exportedAt: obj["exportedAt"] as string,
      presets: presets as Record<string, SavedQueryPreset[]>,
    };
  } catch {
    return null;
  }
}

function ManagePresetsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [presets, setPresets] = useState<FlatPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    setPresets(loadAllPresetsFlat());
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    window.addEventListener(PRESETS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PRESETS_CHANGED_EVENT, refresh);
  }, [open, refresh]);

  const startEditing = (item: FlatPreset) => {
    setEditingId(item.preset.id);
    setEditingName(item.preset.name);
  };

  const commitRename = (item: FlatPreset) => {
    const name = editingName.trim();
    setEditingId(null);
    if (!name || name === item.preset.name) return;
    renamePresetGlobal(item.key, item.preset.id, name);
    toast.success(`Renamed preset to "${name}"`);
  };

  const handleDelete = (item: FlatPreset) => {
    deletePresetGlobal(item.key, item.preset.id);
    toast.success(`Deleted preset "${item.preset.name}"`);
  };

  const handleExport = useCallback(() => {
    const all = loadAllPresets();
    const totalCount = Object.values(all).reduce((sum, arr) => sum + arr.length, 0);
    if (totalCount === 0) {
      toast.error("No presets to export.");
      return;
    }
    const file: PresetsExportFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: all,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `rasokart-presets-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${totalCount} preset${totalCount === 1 ? "" : "s"}`);
  }, []);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const reader = new FileReader();
      reader.onload = (ev) => {
        const raw = ev.target?.result;
        if (typeof raw !== "string") {
          toast.error("Could not read the file.");
          return;
        }
        const parsed = parsePresetsExportFile(raw);
        if (!parsed) {
          toast.error("Invalid presets file. Make sure you're importing a file exported from this page.");
          return;
        }
        const existing = loadAllPresets();
        let imported = 0;
        let skipped = 0;
        for (const key of Object.keys(parsed.presets)) {
          const incoming = parsed.presets[key];
          if (!Array.isArray(incoming)) continue;
          const existingForKey = Array.isArray(existing[key]) ? existing[key] : [];
          const existingNames = new Set(existingForKey.map((p) => p.name));
          const toAdd: SavedQueryPreset[] = [];
          for (const preset of incoming) {
            if (existingNames.has(preset.name)) {
              skipped++;
            } else {
              toAdd.push({
                ...preset,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              });
              existingNames.add(preset.name);
              imported++;
            }
          }
          if (toAdd.length > 0) {
            existing[key] = [...existingForKey, ...toAdd];
          }
        }
        saveAllPresets(existing);
        if (imported === 0 && skipped === 0) {
          toast.info("The file contained no presets.");
        } else if (imported === 0) {
          toast.info(`All ${skipped} preset${skipped === 1 ? "" : "s"} already exist — nothing new was imported.`);
        } else if (skipped === 0) {
          toast.success(`Imported ${imported} preset${imported === 1 ? "" : "s"}.`);
        } else {
          toast.success(
            `Imported ${imported} preset${imported === 1 ? "" : "s"} — ${skipped} already existed and were kept as-is.`
          );
        }
      };
      reader.readAsText(file);
    },
    []
  );

  const methodColors: Record<string, string> = {
    GET: "bg-blue-500/20 text-blue-400",
    POST: "bg-emerald-500/20 text-emerald-400",
    PUT: "bg-yellow-500/20 text-yellow-400",
    DELETE: "bg-rose-500/20 text-rose-400",
    PATCH: "bg-yellow-500/20 text-yellow-400",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage saved presets</DialogTitle>
          <DialogDescription>
            All "Try it" presets saved across every endpoint on this page. Rename or delete them
            here — changes sync immediately to the endpoint panels below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={handleExport}
          >
            <Download className="w-3 h-3" />
            Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="w-3 h-3" />
            Import
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
          <span className="text-xs text-muted-foreground ml-auto">
            {presets.length > 0
              ? `${presets.length} preset${presets.length === 1 ? "" : "s"} saved`
              : "No presets saved yet"}
          </span>
        </div>

        {presets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No presets saved yet. Save one from any "Try it" panel to see it here.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-1.5 -mx-1 px-1">
            {presets.map((item) => (
              <div
                key={`${item.key}::${item.preset.id}`}
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-black/20 px-3 py-2"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  {editingId === item.preset.id ? (
                    <Input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(item);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => commitRename(item)}
                      className="h-7 text-xs bg-black/40"
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
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ApiDocs() {
  const [globalToken, setGlobalToken] = useState<string>(() => {
    try {
      return localStorage.getItem("rasokart_tryit_token") ?? localStorage.getItem("rasokart_token") ?? "";
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

  const handleTokenChange = (val: string) => {
    setGlobalToken(val);
    try {
      localStorage.setItem("rasokart_tryit_token", val);
    } catch {
    }
  };

  return (
    <SharedPresetContext.Provider value={sharedPreset}>
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Documentation</h1>
          <p className="text-muted-foreground mt-1">
            Reference for integrating RasoKart payment APIs into your application.
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
            All requests must include an{" "}
            <code className="font-mono bg-muted px-1 rounded">
              Authorization: Bearer &lt;token&gt;
            </code>{" "}
            header unless noted otherwise.
          </p>

          <div className="pt-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5 text-primary shrink-0" />
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
              placeholder="Paste your JWT token once — it auto-fills every panel"
              className="h-8 text-xs font-mono bg-black/40 border-primary/30"
            />
            {!globalToken && (
              <p className="text-[11px] text-muted-foreground">
                No token set. Log in via the Authentication section below to get one, or paste it
                here directly.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Section title="Dynamic QR API" badge="4 endpoints">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
            <EndpointRow
              method="GET"
              path="/api/qr-codes"
              description="List your QR codes (with search, type, status filters)"
            />
            <EndpointRow
              method="POST"
              path="/api/qr-codes"
              description="Create a dynamic or static QR code"
            />
            <EndpointRow
              method="PUT"
              path="/api/qr-codes/{id}"
              description="Update QR code label or status"
            />
            <EndpointRow
              method="DELETE"
              path="/api/qr-codes/{id}"
              description="Delete a QR code"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Dynamic QR — Request
            </p>
            <CodeBlock
              language="json"
              code={`{
  "type": "dynamic",
  "label": "Order #1234",
  "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
  "amount": "500.00"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Dynamic QR — Response
            </p>
            <CodeBlock
              language="json"
              code={`{
  "id": 1,
  "merchantId": 42,
  "type": "dynamic",
  "label": "Order #1234",
  "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
  "amount": "500.00",
  "status": "active",
  "createdAt": "2026-06-08T10:00:00Z"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">cURL Example</p>
            <CodeBlock
              code={`curl -X POST https://your-domain.com/api/qr-codes \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "dynamic",
    "label": "Order #1234",
    "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
    "amount": "500.00"
  }'`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Try it</p>
            <TryItPanel
              method="GET"
              path="/api/qr-codes"
              token={globalToken}
              commonQueryParams={["search", "type", "status"]}
            />
            <TryItPanel
              method="POST"
              path="/api/qr-codes"
              token={globalToken}
              defaultBody={`{
  "type": "dynamic",
  "label": "Order #1234",
  "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
  "amount": "500.00"
}`}
              expectedBodyKeys={[
                { key: "type", type: "string" },
                { key: "label", type: "string" },
                { key: "payload", type: "string" },
                { key: "amount", type: "string" },
              ]}
            />
            <TryItPanel
              method="PUT"
              path="/api/qr-codes/{id}"
              token={globalToken}
              defaultBody={`{
  "label": "Updated Label",
  "status": "active"
}`}
              expectedBodyKeys={[
                { key: "label", type: "string" },
                { key: "status", type: "string" },
              ]}
            />
            <TryItPanel method="DELETE" path="/api/qr-codes/{id}" token={globalToken} />
          </div>
        </Section>

        <Section title="Virtual Account API" badge="4 endpoints">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
            <EndpointRow
              method="POST"
              path="/api/virtual-accounts"
              description="Create a virtual account"
            />
            <EndpointRow
              method="GET"
              path="/api/virtual-accounts"
              description="List all virtual accounts"
            />
            <EndpointRow
              method="PUT"
              path="/api/virtual-accounts/{id}"
              description="Update or close account"
            />
            <EndpointRow
              method="DELETE"
              path="/api/virtual-accounts/{id}"
              description="Delete virtual account"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Virtual Account — Request
            </p>
            <CodeBlock
              language="json"
              code={`{
  "accountNumber": "1234567890123456",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "accountHolder": "MyStore Ltd",
  "label": "Collections Account"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Virtual Account — Response
            </p>
            <CodeBlock
              language="json"
              code={`{
  "id": 5,
  "merchantId": 42,
  "accountNumber": "1234567890123456",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "accountHolder": "MyStore Ltd",
  "label": "Collections Account",
  "status": "active",
  "createdAt": "2026-06-08T10:00:00Z"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">cURL Example</p>
            <CodeBlock
              code={`curl -X POST https://your-domain.com/api/virtual-accounts \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accountNumber": "1234567890123456",
    "ifsc": "HDFC0001234",
    "bankName": "HDFC Bank",
    "accountHolder": "MyStore Ltd"
  }'`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Try it</p>
            <TryItPanel method="GET" path="/api/virtual-accounts" token={globalToken} />
            <TryItPanel
              method="POST"
              path="/api/virtual-accounts"
              token={globalToken}
              defaultBody={`{
  "accountNumber": "1234567890123456",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "accountHolder": "MyStore Ltd",
  "label": "Collections Account"
}`}
              expectedBodyKeys={[
                { key: "accountNumber", type: "string" },
                { key: "ifsc", type: "string" },
                { key: "bankName", type: "string" },
                { key: "accountHolder", type: "string" },
                { key: "label", type: "string" },
              ]}
            />
            <TryItPanel
              method="PUT"
              path="/api/virtual-accounts/{id}"
              token={globalToken}
              defaultBody={`{
  "label": "Updated Label",
  "status": "active"
}`}
              expectedBodyKeys={[
                { key: "label", type: "string" },
                { key: "status", type: "string" },
              ]}
            />
            <TryItPanel method="DELETE" path="/api/virtual-accounts/{id}" token={globalToken} />
          </div>
        </Section>

        <Section title="Transactions API" badge="read-only">
          <p className="text-sm text-muted-foreground">
            Query your deposits and withdrawals for reconciliation, reporting, or building your own
            transaction dashboards. This endpoint is read-only — transactions themselves are created
            by QR/VA/payment-link payments and provider callbacks, not by direct API writes.
          </p>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
            <EndpointRow
              method="GET"
              path="/api/transactions"
              description="List your deposits and withdrawals, with filters and pagination"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Query Parameters</p>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Param</th>
                    <th className="text-left font-medium px-3 py-2">Type</th>
                    <th className="text-left font-medium px-3 py-2">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {[
                    ["type", "deposit | withdrawal | all", "Filter by transaction type. Defaults to all."],
                    ["status", "pending | success | failed | all", "Filter by transaction status. Defaults to all."],
                    ["search", "string", "Matches against UTR or reference ID (partial, case-insensitive)."],
                    ["dateFrom", "YYYY-MM-DD", "Only include transactions created on or after this date."],
                    ["dateTo", "YYYY-MM-DD", "Only include transactions created on or before this date (end of day)."],
                    ["amountMin", "number", "Minimum transaction amount."],
                    ["amountMax", "number", "Maximum transaction amount."],
                    ["connectionProvider", "string", "Filter by linked provider (e.g. cashfree)."],
                    ["paymentLinkId", "number", "Only transactions from a specific payment link."],
                    ["page", "number", "Page number, 1-indexed. Defaults to 1."],
                    ["limit", "number", "Results per page, max 100. Defaults to 20."],
                  ].map(([param, type, desc]) => (
                    <tr key={param}>
                      <td className="px-3 py-2 font-mono text-foreground">{param}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{type}</td>
                      <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Merchants only ever see their own transactions — <code className="font-mono bg-muted px-1 rounded">merchantId</code> is
              ignored unless the request is made by an admin.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Example Response</p>
            <CodeBlock
              language="json"
              code={`{
  "data": [
    {
      "id": 101,
      "merchantId": 42,
      "type": "deposit",
      "status": "success",
      "amount": 500.00,
      "currency": "INR",
      "utr": "UTR123456789",
      "referenceId": "ORDER-1234",
      "description": "Payment via QR Code: Order #1234",
      "connectionProvider": "cashfree",
      "merchantName": "MyStore Ltd",
      "createdAt": "2026-06-08T10:00:00Z",
      "updatedAt": "2026-06-08T10:00:05Z"
    }
  ],
  "total": 128,
  "page": 1,
  "limit": 20,
  "stats": {
    "depositVolume": 45230.50,
    "withdrawalVolume": 12000.00,
    "successCount": 110,
    "failedCount": 8,
    "pendingCount": 10
  }
}`}
            />
            <p className="text-xs text-muted-foreground mt-2">
              <code className="font-mono bg-muted px-1 rounded">stats</code> reflects the full filtered
              result set (not just the current page), so it's safe to use for summary cards.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">cURL Example</p>
            <CodeBlock
              code={`curl -G https://your-domain.com/api/transactions \\
  -H "Authorization: Bearer <your-token>" \\
  --data-urlencode "type=deposit" \\
  --data-urlencode "status=success" \\
  --data-urlencode "dateFrom=2026-06-01" \\
  --data-urlencode "dateTo=2026-06-30" \\
  --data-urlencode "page=1" \\
  --data-urlencode "limit=20"`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Try it</p>
            <TryItPanel
              method="GET"
              path="/api/transactions"
              token={globalToken}
              commonQueryParams={[
                "type",
                "status",
                "search",
                "dateFrom",
                "dateTo",
                "amountMin",
                "amountMax",
                "connectionProvider",
                "paymentLinkId",
                "page",
                "limit",
              ]}
            />
          </div>
        </Section>

        <Section title="Webhook Events Reference" badge="5 event types">
          <p className="text-sm text-muted-foreground">
            RasoKart sends POST requests to your configured webhook URL when events occur.
          </p>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Payment Success Webhook Payload
            </p>
            <CodeBlock
              language="json"
              code={`{
  "event": "payment.success",
  "timestamp": "2026-06-08T10:00:00Z",
  "data": {
    "transactionId": 101,
    "utr": "UTR123456789",
    "amount": 500.00,
    "currency": "INR",
    "merchantId": 42,
    "referenceId": "ORDER-1234",
    "qrCodeId": 1,
    "status": "success"
  }
}`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Payment Failed Webhook Payload
            </p>
            <CodeBlock
              language="json"
              code={`{
  "event": "payment.failed",
  "timestamp": "2026-06-08T10:01:00Z",
  "data": {
    "transactionId": 102,
    "utr": "UTR987654321",
    "amount": 250.00,
    "currency": "INR",
    "merchantId": 42,
    "status": "failed",
    "failureReason": "Insufficient funds"
  }
}`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Virtual Account Credit Webhook
            </p>
            <CodeBlock
              language="json"
              code={`{
  "event": "va.credited",
  "timestamp": "2026-06-08T10:02:00Z",
  "data": {
    "virtualAccountId": 5,
    "accountNumber": "1234567890123456",
    "amount": 1000.00,
    "currency": "INR",
    "utr": "UTR111111111",
    "remitterName": "John Doe",
    "merchantId": 42
  }
}`}
            />
          </div>
        </Section>

        <Section title="Callback Security" badge="HMAC-SHA256">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <ShieldCheck className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-300">Two separate signing secrets</p>
              <p className="text-xs text-muted-foreground">
                RasoKart uses{" "}
                <strong className="text-foreground">two distinct secrets</strong> for different
                directions of data flow:
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 mt-1 list-disc list-inside">
                <li>
                  <strong className="text-foreground">Outbound Webhook Secret</strong> — RasoKart
                  signs the event payloads it sends <em>to your endpoint</em> (payment.success,
                  va.credited, etc.). Use this to verify that incoming webhook calls genuinely came
                  from RasoKart.
                </li>
                <li>
                  <strong className="text-foreground">Inbound Callback Secret</strong> — Your server
                  signs the payment-result callbacks it sends <em>to RasoKart</em> (e.g. after a UPI
                  deep-link redirect). Use this so RasoKart can verify the callback came from you.
                </li>
              </ul>
              <p className="text-xs text-muted-foreground mt-1">
                Both secrets are generated on the{" "}
                <a
                  href="/merchant/webhook"
                  className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2"
                >
                  Webhook Settings <ExternalLink className="w-3 h-3" />
                </a>{" "}
                page.
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">
              X-Signature Header Format
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              Every signed request (both directions) carries an{" "}
              <code className="font-mono bg-muted px-1 rounded">X-Signature</code> header in the
              format:
            </p>
            <CodeBlock code={`X-Signature: sha256=<hex-encoded HMAC-SHA256 digest>`} />
            <p className="text-xs text-muted-foreground mt-2">
              The digest is computed over the raw request body bytes using the appropriate secret as
              the HMAC key.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Verify an Inbound Webhook — Node.js
            </p>
            <CodeBlock
              language="javascript"
              code={`const crypto = require("crypto");

// Your outbound webhook secret from the Webhook Settings page
const WEBHOOK_SECRET = process.env.RASOKART_WEBHOOK_SECRET;

function verifyRasoKartWebhook(rawBody, signatureHeader) {
  // signatureHeader is the value of X-Signature from the request
  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)          // rawBody must be the raw Buffer, not parsed JSON
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  // Buffers must be the same length or timingSafeEqual throws
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express example
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-signature"];
  if (!sig || !verifyRasoKartWebhook(req.body, sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  const event = JSON.parse(req.body);
  // process event.event, event.data …
  res.json({ received: true });
});`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Verify an Inbound Webhook — Python
            </p>
            <CodeBlock
              language="python"
              code={`import hmac, hashlib, os
from flask import Flask, request, abort

WEBHOOK_SECRET = os.environ["RASOKART_WEBHOOK_SECRET"].encode()

app = Flask(__name__)

@app.route("/webhook", methods=["POST"])
def webhook():
    sig_header = request.headers.get("X-Signature", "")
    body = request.get_data()  # raw bytes — do NOT call request.json() first

    expected = "sha256=" + hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, sig_header):
        abort(401)  # signature mismatch — reject the request

    event = request.get_json()
    # process event["event"], event["data"] …
    return {"received": True}, 200`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Sign an Outbound Callback — Node.js
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              When your server sends a payment-result callback <em>back to RasoKart</em>, sign it
              with your inbound callback secret:
            </p>
            <CodeBlock
              language="javascript"
              code={`const crypto = require("crypto");

// Your inbound callback secret from the Webhook Settings page
const CALLBACK_SECRET = process.env.RASOKART_CALLBACK_SECRET;

function signCallback(body) {
  // body must be the JSON string you are about to POST
  return "sha256=" + crypto
    .createHmac("sha256", CALLBACK_SECRET)
    .update(body)
    .digest("hex");
}

const payload = JSON.stringify({ transactionId: 101, status: "success" });
const signature = signCallback(payload);

await fetch("https://your-domain.com/api/callbacks/payment", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Signature": signature,
  },
  body: payload,
});`}
            />
          </div>

          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-1">
            <p className="text-sm font-medium text-rose-300">What happens when verification fails</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>
                RasoKart rejects inbound callbacks with a{" "}
                <code className="font-mono bg-muted px-1 rounded">401 Unauthorized</code> response
                and the payment event is not recorded.
              </li>
              <li>
                Your server should return a non-2xx status for failed outbound webhook signatures.
                RasoKart will retry delivery up to 5 times with exponential back-off before marking
                the webhook attempt as failed.
              </li>
              <li>
                Never fall back to accepting unsigned requests — always reject on mismatch to prevent
                replay or spoofing attacks.
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              Generate or rotate your signing secrets on the{" "}
              <a
                href="/merchant/webhook"
                className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2"
              >
                Webhook Settings page <ExternalLink className="w-3 h-3" />
              </a>
              .
            </span>
          </div>
        </Section>

        <Section title="Authentication" badge="JWT Bearer">
          <p className="text-sm text-muted-foreground">
            All API requests require a valid JWT token obtained from the login endpoint.
          </p>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Login Request</p>
            <CodeBlock
              code={`curl -X POST https://your-domain.com/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "you@merchant.com", "password": "your-password"}'`}
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
    "email": "you@merchant.com",
    "role": "merchant",
    "name": "Your Name"
  }
}`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Using the Token</p>
            <CodeBlock
              code={`curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \\
  https://your-domain.com/api/transactions`}
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
  "email": "merchant@demo.com",
  "password": "Merchant@123456"
}`}
              expectedBodyKeys={[
                { key: "email", type: "string" },
                { key: "password", type: "string" },
              ]}
            />
          </div>
        </Section>
      </div>
    </div>
    </SharedPresetContext.Provider>
  );
}
