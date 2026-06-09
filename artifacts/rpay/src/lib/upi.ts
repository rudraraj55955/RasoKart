/**
 * UPI payment address helpers for virtual accounts.
 *
 * UPI VPA (Virtual Payment Address) format for bank virtual accounts:
 *   {accountNumber}@{bankHandle}
 *
 * where bankHandle is the bank's NPCI-registered UPI PSP handle
 * (e.g. "hdfc", "icici", "sbi", "axisbank").
 * It is derived from the first 4 characters of the IFSC code via a
 * well-known mapping — NOT the full IFSC (which is a routing code,
 * not a UPI handle).
 *
 * UPI deep-link format:
 *   upi://pay?pa=<VPA>&pn=<payeeName>&cu=INR
 */

const IFSC_TO_UPI_HANDLE: Record<string, string> = {
  HDFC: "hdfc",
  ICIC: "icici",
  SBIN: "sbi",
  UTIB: "axisbank",
  KKBK: "kotak",
  YESB: "yesbank",
  IDFB: "idfcbank",
  PUNB: "pnb",
  BARB: "barodampay",
  CNRB: "canarabank",
  UBIN: "unionbank",
  IDIB: "indianbank",
  BKID: "boi",
  CORP: "corporationbank",
  RATN: "rblbank",
  FDRL: "federalbank",
  KARB: "kbl",
  SIBL: "southindian",
  KVBL: "kvb",
  TMBL: "tmb",
  DLXB: "dlxb",
  MAHB: "mahb",
  ALLA: "allahabadbank",
  VIJB: "vijayabank",
  DENA: "denabank",
  ORBC: "pnb",
};

export function getBankHandle(ifsc: string): string {
  const prefix = ifsc.substring(0, 4).toUpperCase();
  return IFSC_TO_UPI_HANDLE[prefix] ?? prefix.toLowerCase();
}

export function buildUpiId(accountNumber: string, ifsc: string): string {
  return `${accountNumber}@${getBankHandle(ifsc)}`;
}

export function buildUpiUrl(
  accountNumber: string,
  ifsc: string,
  accountHolder: string,
): string {
  const pa = encodeURIComponent(buildUpiId(accountNumber, ifsc));
  const pn = encodeURIComponent(accountHolder);
  return `upi://pay?pa=${pa}&pn=${pn}&cu=INR`;
}
