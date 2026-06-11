import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
} from "date-fns";

export interface SmartFilterBase {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

export function parseDateToken(
  token: string,
  now: Date,
): Pick<SmartFilterBase, "dateFrom" | "dateTo"> | null {
  if (token === "today") {
    return {
      dateFrom: format(startOfDay(now), "yyyy-MM-dd"),
      dateTo: format(endOfDay(now), "yyyy-MM-dd"),
    };
  }
  if (token === "this week") {
    return {
      dateFrom: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      dateTo: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (token === "this month") {
    return {
      dateFrom: format(startOfMonth(now), "yyyy-MM-dd"),
      dateTo: format(endOfMonth(now), "yyyy-MM-dd"),
    };
  }
  if (token === "last month") {
    const prev = subMonths(now, 1);
    return {
      dateFrom: format(startOfMonth(prev), "yyyy-MM-dd"),
      dateTo: format(endOfMonth(prev), "yyyy-MM-dd"),
    };
  }
  if (token === "last week") {
    const prevWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    const prevWeekEnd = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    return {
      dateFrom: format(prevWeekStart, "yyyy-MM-dd"),
      dateTo: format(prevWeekEnd, "yyyy-MM-dd"),
    };
  }
  return null;
}

export function parseAmountToken(
  token: string,
): Pick<SmartFilterBase, "amountMin" | "amountMax"> | null {
  const gtMatch = token.match(/^(>=?)(\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    const inclusive = gtMatch[1] === ">=";
    const val = parseFloat(gtMatch[2]!);
    return { amountMin: inclusive ? val : val + 0.01 };
  }
  const ltMatch = token.match(/^(<=?)(\d+(?:\.\d+)?)$/);
  if (ltMatch) {
    const inclusive = ltMatch[1] === "<=";
    const val = parseFloat(ltMatch[2]!);
    return { amountMax: inclusive ? val : val - 0.01 };
  }
  const rangeMatch = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]!);
    const max = parseFloat(rangeMatch[2]!);
    if (min <= max) return { amountMin: min, amountMax: max };
  }
  return null;
}

/**
 * Parse a freeform smart-search query string into a typed filter object.
 *
 * @param raw        The raw query string entered by the user.
 * @param keywordMaps  One or more maps of lowercase keyword → partial filter to merge.
 *                     Evaluated in order; first match per token wins within each map.
 *
 * @example
 * parseSmartQuery("success this month >=500", [
 *   { success: { txStatus: "success" }, failed: { txStatus: "failed" } },
 * ])
 * // → { txStatus: "success", dateFrom: "...", dateTo: "...", amountMin: 500 }
 */
export function parseSmartQuery<T extends SmartFilterBase>(
  raw: string,
  keywordMaps: Array<Record<string, Partial<T>>>,
): T | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  const filter = {} as T;
  const now = new Date();

  for (const phrase of ["this week", "this month", "last month", "last week"]) {
    if (q.includes(phrase)) {
      const dateResult = parseDateToken(phrase, now);
      if (dateResult) {
        Object.assign(filter, dateResult);
        break;
      }
    }
  }

  let remaining = q;
  if (filter.dateFrom) {
    for (const phrase of ["this week", "this month", "last month", "last week"]) {
      remaining = remaining.replace(phrase, "").trim();
    }
  }

  const tokens = remaining.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    let matched = false;
    for (const map of keywordMaps) {
      if (token in map) {
        Object.assign(filter, map[token]);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (!filter.dateFrom) {
      const dateResult = parseDateToken(token, now);
      if (dateResult) {
        Object.assign(filter, dateResult);
        continue;
      }
    }
    if (filter.amountMin == null && filter.amountMax == null) {
      const amtResult = parseAmountToken(token);
      if (amtResult) {
        Object.assign(filter, amtResult);
        continue;
      }
    }
  }

  const hasContent = Object.values(filter).some((v) => v != null);
  return hasContent ? filter : null;
}
