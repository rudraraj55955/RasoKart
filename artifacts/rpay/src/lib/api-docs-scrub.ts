/**
 * Credential-scrubbing utilities for the API Docs Try-It panel.
 *
 * Extracted as a pure module so it can be unit-tested independently of the
 * React component tree. The two adapters (`scrubCredentialsFromPreset` and
 * `scrubCredentialsForShare`) wrap the shared `scrubFields` core and are the
 * only entry-points used by api-docs.tsx.
 */

export interface SavedQueryPreset {
  id: string;
  name: string;
  pathValues: Record<string, string>;
  queryParams: { key: string; value: string }[];
  body: string;
  lastUsedAt?: string;
}

export interface ScrubbedShareFields {
  pathValues: Record<string, string>;
  queryParams: { key: string; value: string }[];
  body: string;
  redactedFields: string[];
}

/**
 * Returns true when `value` looks like a live credential that should never
 * appear in an export file or share link.
 *
 * Recognised patterns:
 *  - RasoKart API keys  (`rasokart_live_*` / `rasokart_secret_*`)
 *  - JWTs              (three dot-separated segments where the first two start
 *                       with "ey", the standard base64url header/payload prefix)
 */
export function looksLikeCredential(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("rasokart_live_") || trimmed.startsWith("rasokart_secret_")) return true;
  const parts = trimmed.split(".");
  if (parts.length === 3 && parts[0].startsWith("ey") && parts[1].startsWith("ey")) return true;
  return false;
}

/**
 * Shared credential-scrubbing core used by both the share-link and export flows.
 *
 * Walks pathValues, queryParams, and the JSON body, replacing any
 * credential-shaped value (per `looksLikeCredential`) with "[REDACTED]".
 *
 * When `onRedacted` is supplied it is called with a human-readable label for
 * every field that was stripped — the share-link flow uses this to build the
 * summary shown to the sender and recipient. The export flow omits it.
 */
export function scrubFields(
  pathValues: Record<string, string>,
  queryParams: { key: string; value: string }[],
  body: string,
  onRedacted?: (label: string) => void
): { pathValues: Record<string, string>; queryParams: { key: string; value: string }[]; body: string } {
  const outPathValues: Record<string, string> = {};
  for (const [key, val] of Object.entries(pathValues)) {
    if (looksLikeCredential(val)) {
      outPathValues[key] = "[REDACTED]";
      onRedacted?.(`path param "{${key}}"`);
    } else {
      outPathValues[key] = val;
    }
  }

  const outQueryParams = queryParams.map((row) => {
    if (looksLikeCredential(row.value)) {
      onRedacted?.(`query param "${row.key}"`);
      return { key: row.key, value: "[REDACTED]" };
    }
    return row;
  });

  let outBody = body;
  if (body.trim()) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const scrubJsonValue = (value: unknown, path: string): unknown => {
        if (typeof value === "string") {
          if (looksLikeCredential(value)) {
            onRedacted?.(path ? `body field "${path}"` : "request body");
            return "[REDACTED]";
          }
          return value;
        } else if (Array.isArray(value)) {
          return value.map((item, i) => scrubJsonValue(item, `${path}[${i}]`));
        } else if (value !== null && typeof value === "object") {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = scrubJsonValue(v, path ? `${path}.${k}` : k);
          }
          return out;
        }
        return value;
      };
      outBody = JSON.stringify(scrubJsonValue(parsed, ""), null, 2);
    } catch {
      if (looksLikeCredential(body)) {
        onRedacted?.("request body");
        outBody = "[REDACTED]";
      }
    }
  }

  return { pathValues: outPathValues, queryParams: outQueryParams, body: outBody };
}

/**
 * Deep-scrubs any field that looks like a credential (via `looksLikeCredential`)
 * out of a preset before it's ever serialized into an export file. Presets don't
 * intentionally store bearer tokens today, but this is a defense-in-depth guard
 * in case a token ever lands in pathValues/queryParams/body.
 *
 * Export adapter — no `onRedacted` callback, so `redactedFields` is never
 * populated. The scrubbed preset is safe to write to a file as-is.
 */
export function scrubCredentialsFromPreset(preset: SavedQueryPreset): SavedQueryPreset {
  const { pathValues, queryParams, body } = scrubFields(
    preset.pathValues,
    preset.queryParams,
    preset.body
  );
  return { ...preset, pathValues, queryParams, body };
}

export function scrubCredentialsFromAllPresets(
  all: Record<string, SavedQueryPreset[]>
): Record<string, SavedQueryPreset[]> {
  const scrubbed: Record<string, SavedQueryPreset[]> = {};
  for (const [key, presets] of Object.entries(all)) {
    scrubbed[key] = presets.map(scrubCredentialsFromPreset);
  }
  return scrubbed;
}

/**
 * Blanks any credential-shaped value out of the fields that get encoded into a
 * share link, replacing it with "[REDACTED]" and returning the human-readable
 * labels of what was stripped so the sender can be shown a summary and the
 * recipient can be shown a note.
 *
 * Share-link adapter — supplies `onRedacted` to collect `redactedFields`.
 */
export function scrubCredentialsForShare(
  pathValues: Record<string, string>,
  queryParams: { key: string; value: string }[],
  body: string
): ScrubbedShareFields {
  const redactedFields: string[] = [];
  const scrubbed = scrubFields(pathValues, queryParams, body, (label) =>
    redactedFields.push(label)
  );
  return { ...scrubbed, redactedFields };
}
