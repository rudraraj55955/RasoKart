const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const APP_VERSION: string = (() => {
  try {
    return typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "2.1.0";
  } catch {
    return "2.1.0";
  }
})();

export const BUILD_DATE: string = (() => {
  try {
    return typeof __BUILD_DATE__ === "string" && __BUILD_DATE__ ? __BUILD_DATE__ : "";
  } catch {
    return "";
  }
})();

export function formatBuildDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  const year = match[1];
  const monthIdx = Number(match[2]) - 1;
  const day = Number(match[3]);
  const monthLabel = MONTHS[monthIdx];
  if (!monthLabel || Number.isNaN(day)) return isoDate;
  return `${day} ${monthLabel} ${year}`;
}

export function getBuildStampLabel(version = APP_VERSION, buildDate = BUILD_DATE): string {
  const v = version.startsWith("v") ? version : `v${version}`;
  if (!buildDate) return v;
  return `${v} · ${formatBuildDate(buildDate)}`;
}
