export const PROVIDER_VPA_SUFFIX: Record<string, string> = {
  phonepe: "ybl",
  paytm: "paytm",
  bharatpe: "bharatpe",
  yono_sbi: "sbi",
  hdfc_smarthub: "hdfcbank",
};

export function deriveVpa(provider: string, credentials: string | null): string | null {
  let creds: Record<string, string> = {};
  let isJson = false;
  try { if (credentials) { creds = JSON.parse(credentials); isJson = true; } } catch {}

  // Any provider may store a pre-formed VPA directly under the "vpa" key
  if (creds["vpa"]) return creds["vpa"];

  if (provider === "upi_id") {
    // Try "UPI ID" key first, then fall back to a plain-string credential
    return creds["UPI ID"] ?? (!isJson && credentials ? credentials : null);
  }

  const suffix = PROVIDER_VPA_SUFFIX[provider];
  const mid = creds["Merchant ID"] ?? creds["MID"] ?? null;
  if (mid && suffix) return `${mid}@${suffix}`;
  return null;
}

export function buildUpiPayload(vpa: string, name: string, amount: string | null, note: string | null): string {
  const params = new URLSearchParams({ pa: vpa, pn: name, cu: "INR" });
  if (amount) params.set("am", amount);
  if (note) params.set("tn", note);
  return `upi://pay?${params.toString()}`;
}

export function deriveUpiPayloadFromConnections(
  connections: Array<{ provider: string; credentials: string | null; isActive: boolean }>,
  merchantName: string,
  amount: string | null,
  note: string | null,
): string | null {
  const active = connections.filter(c => c.isActive);
  const sorted = [...active].sort(a => a.provider === "upi_id" ? -1 : 1);
  for (const conn of sorted) {
    const vpa = deriveVpa(conn.provider, conn.credentials ?? null);
    if (vpa) return buildUpiPayload(vpa, merchantName, amount, note);
  }
  return null;
}
