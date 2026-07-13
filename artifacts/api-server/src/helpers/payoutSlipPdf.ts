import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ── Types ───────────────────────────────────────────────────────────────────
export type PayoutDisplayStatus = "SUCCESS" | "FAILED" | "REJECTED" | "PROCESSING";

export interface PayoutSlipData {
  id: number;
  receiptId: string;
  merchantId: number;
  merchantBusinessName: string;
  generatedAt: string;

  amount: number;
  currency: string;
  payoutFee: number;
  gstAmount: number;
  totalDebit: number;
  payoutMode: string;

  displayStatus: PayoutDisplayStatus;
  statusLabel: string;
  isNotFinal: boolean;
  walletRefunded: boolean;

  utrDisplay: string;

  transferDate: string | null;
  transactionDateTime: string | null;
  requestedAt: string;

  safeFailureReason: string | null;
  rejectionReason: string | null;

  beneficiary: {
    name: string | null;
    bankName: string | null;
    maskedAccount: string | null;
    ifscCode: string | null;
    maskedUpi: string | null;
  };

  remarks: string | null;
  isUpi: boolean;

  verificationCode: string | null;
  verificationToken: string | null;
  verificationUrl: string | null;

  supportEmail: string | null;
  supportPhone: string | null;
}

// ── Colours ─────────────────────────────────────────────────────────────────
const C = {
  brand:      "#4338ca",
  dark:       "#0f172a",
  bodyText:   "#1e293b",
  mutedText:  "#64748b",
  border:     "#cbd5e1",
  borderLight:"#e2e8f0",
  lightBg:    "#f8fafc",
  white:      "#ffffff",
  watermark:  "#f1f5f9",

  successBg:  "#dcfce7", successFg: "#15803d",
  failBg:     "#fee2e2", failFg:    "#b91c1c",
  procBg:     "#fef9c3", procFg:    "#a16207",
  rejBg:      "#fff7ed", rejFg:     "#c2410c",
};

function statusStyle(s: PayoutDisplayStatus): { bg: string; fg: string } {
  switch (s) {
    case "SUCCESS":    return { bg: C.successBg, fg: C.successFg };
    case "FAILED":     return { bg: C.failBg,    fg: C.failFg    };
    case "REJECTED":   return { bg: C.rejBg,     fg: C.rejFg     };
    default:           return { bg: C.procBg,    fg: C.procFg    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function inr(n: number): string {
  if (n === 0) return "Nil";
  return "INR " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function inrForced(n: number): string {
  return "INR " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safe(v: string | null | undefined): string {
  return v ?? "—";
}

function hrule(
  doc: InstanceType<typeof PDFDocument>,
  x: number, y: number, w: number,
  color = C.borderLight, thickness = 0.5,
) {
  doc.save()
     .moveTo(x, y).lineTo(x + w, y)
     .strokeColor(color).lineWidth(thickness).stroke()
     .restore();
}

function kvRow(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
  value: string,
  x: number, y: number,
  lblW: number, valW: number,
  valColor = C.bodyText,
): number {
  const ROW_H = 20;
  doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
     .text(label, x, y + 4, { width: lblW, lineBreak: false });
  doc.fillColor(valColor).fontSize(8.5).font("Helvetica-Bold")
     .text(value, x + lblW, y + 3, { width: valW, lineBreak: false });
  return y + ROW_H;
}

function statusBadgeText(s: PayoutDisplayStatus): string {
  switch (s) {
    case "SUCCESS":    return "SUCCESS";
    case "FAILED":     return "FAILED";
    case "REJECTED":   return "REJECTED";
    default:           return "PROCESSING";
  }
}

// ── Main builder ─────────────────────────────────────────────────────────────
export async function buildPayoutSlipPdf(slip: PayoutSlipData): Promise<Buffer> {
  // Pre-generate QR buffer (if token available)
  let qrBuf: Buffer | null = null;
  if (slip.verificationUrl) {
    try {
      qrBuf = await QRCode.toBuffer(slip.verificationUrl, {
        type: "png",
        width: 80,
        margin: 1,
        color: { dark: C.dark, light: C.white },
      });
    } catch {
      qrBuf = null;
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W  = doc.page.width;   // 595.28
    const H  = doc.page.height;  // 841.89
    const MG = 40;
    const CW = W - MG * 2;      // 515.28
    const LBL_W = 190;
    const VAL_W = CW - LBL_W;

    // ── WATERMARK ─────────────────────────────────────────────────────────────
    doc.save()
       .rotate(45, { origin: [W / 2, H / 2] })
       .fillColor(C.watermark).fontSize(72).font("Helvetica-Bold")
       .text("RASOKART", W / 2 - 160, H / 2 - 36, { width: 320, align: "center", lineBreak: false })
       .restore();

    // ── HEADER ────────────────────────────────────────────────────────────────
    let y = MG;

    // Brand mark (top-right)
    const brandStr = "RasoKart";
    doc.fillColor(C.brand).fontSize(16).font("Helvetica-Bold")
       .text(brandStr, MG, y, { width: CW, align: "right", lineBreak: false });
    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
       .text(`Generated: ${slip.generatedAt}`, MG, y + 20, { width: CW, align: "right" });

    // Document title (top-left)
    doc.fillColor(C.dark).fontSize(20).font("Helvetica-Bold")
       .text("Payout Transaction Details", MG, y, { width: CW * 0.55, lineBreak: false });
    doc.fillColor(C.mutedText).fontSize(9).font("Helvetica")
       .text("RasoKart Payment Gateway", MG, y + 23, { width: CW * 0.55 });

    y = 96;
    hrule(doc, MG, y, CW, C.border, 1);
    y += 12;

    // ── MERCHANT INFO ─────────────────────────────────────────────────────────
    doc.fillColor(C.dark).fontSize(12).font("Helvetica-Bold")
       .text(`Dear, ${safe(slip.merchantBusinessName)}`, MG, y);
    y += 18;
    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
       .text(`Merchant ID: RK-M-${slip.merchantId}  ·  Transfer Ref: ${slip.receiptId}`, MG, y);
    y += 14;
    hrule(doc, MG, y, CW, C.borderLight);
    y += 12;

    // ── STATUS BANNER ─────────────────────────────────────────────────────────
    const st = statusStyle(slip.displayStatus);
    doc.rect(MG, y, CW, 28).fill(st.bg);
    doc.fillColor(st.fg).fontSize(10).font("Helvetica-Bold")
       .text(`Status: ${statusBadgeText(slip.displayStatus)}  —  ${slip.statusLabel}`, MG + 12, y + 9, { width: CW - 24, lineBreak: false });
    if (slip.isNotFinal) {
      doc.fillColor(C.procFg).fontSize(8).font("Helvetica")
         .text("NOT FINAL — may update", MG + 12, y + 9, { width: CW - 24, align: "right", lineBreak: false });
    }
    y += 36;

    // ── TRANSACTION DETAILS ───────────────────────────────────────────────────
    doc.rect(MG, y, CW, 16).fill(C.lightBg);
    doc.fillColor(C.dark).fontSize(7.5).font("Helvetica-Bold")
       .text("TRANSACTION DETAILS", MG + 8, y + 4, { width: CW - 16, lineBreak: false });
    y += 22;

    y = kvRow(doc, "RasoKart Transfer ID",    slip.receiptId,                  MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "UTR / Bank Reference",     slip.utrDisplay,                 MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "Transaction Type",         "DOMESTIC PAYOUT",               MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "From",                     "RasoKart Payout Account",        MG, y, LBL_W, VAL_W);

    if (slip.isUpi && slip.beneficiary.maskedUpi) {
      y = kvRow(doc, "UPI / VPA",              safe(slip.beneficiary.maskedUpi), MG, y, LBL_W, VAL_W);
    } else {
      y = kvRow(doc, "To Account Number",      safe(slip.beneficiary.maskedAccount), MG, y, LBL_W, VAL_W);
      y = kvRow(doc, "Bank Name",              safe(slip.beneficiary.bankName),  MG, y, LBL_W, VAL_W);
      y = kvRow(doc, "IFSC Code",              safe(slip.beneficiary.ifscCode),  MG, y, LBL_W, VAL_W);
    }

    y = kvRow(doc, "Beneficiary Name",         safe(slip.beneficiary.name),     MG, y, LBL_W, VAL_W);
    hrule(doc, MG, y, CW);
    y += 6;

    y = kvRow(doc, "Amount",                   inrForced(slip.amount),          MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "Payout Fee",               inr(slip.payoutFee),             MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "GST",                      inr(slip.gstAmount),             MG, y, LBL_W, VAL_W);

    hrule(doc, MG, y, CW, C.border);
    y += 4;
    // Total debit row — bold on both sides
    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica-Bold")
       .text("Total Debit", MG, y + 4, { width: LBL_W, lineBreak: false });
    doc.fillColor(C.dark).fontSize(9).font("Helvetica-Bold")
       .text(inrForced(slip.totalDebit), MG + LBL_W, y + 3, { width: VAL_W, lineBreak: false });
    y += 20;

    hrule(doc, MG, y, CW);
    y += 6;

    y = kvRow(doc, "Mode",            slip.payoutMode,                         MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "Transfer Type",   "One Time",                              MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "Transfer Date",   safe(slip.transferDate),                 MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "Transaction Date",safe(slip.transactionDateTime),          MG, y, LBL_W, VAL_W);
    y = kvRow(doc, "Requested On",    slip.requestedAt,                        MG, y, LBL_W, VAL_W);

    if (slip.remarks) {
      y = kvRow(doc, "Description",   slip.remarks,                            MG, y, LBL_W, VAL_W);
    }

    // Failure / rejection reasons
    if (slip.safeFailureReason) {
      hrule(doc, MG, y, CW, C.failBg);
      y += 6;
      y = kvRow(doc, "Failure Reason", slip.safeFailureReason, MG, y, LBL_W, VAL_W, C.failFg);
    }
    if (slip.rejectionReason) {
      hrule(doc, MG, y, CW, C.rejBg);
      y += 6;
      y = kvRow(doc, "Rejection Reason", slip.rejectionReason, MG, y, LBL_W, VAL_W, C.rejFg);
    }

    y += 4;
    hrule(doc, MG, y, CW, C.border, 1);
    y += 16;

    // ── VERIFICATION SECTION ─────────────────────────────────────────────────
    if (slip.verificationCode) {
      doc.rect(MG, y, CW, 16).fill(C.lightBg);
      doc.fillColor(C.dark).fontSize(7.5).font("Helvetica-Bold")
         .text("VERIFICATION", MG + 8, y + 4, { width: CW - 16, lineBreak: false });
      y += 22;

      const qrW = 80;
      const qrX = MG + CW - qrW;
      const verY = y;

      // Verification text (left side)
      doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
         .text("Verification Code", MG, y + 2, { width: LBL_W, lineBreak: false });
      doc.fillColor(C.dark).fontSize(9).font("Helvetica-Bold")
         .text(slip.verificationCode, MG + LBL_W, y + 1, { width: CW - LBL_W - qrW - 16, lineBreak: false });
      y += 18;

      doc.fillColor(C.mutedText).fontSize(7.5).font("Helvetica")
         .text("Scan QR or visit the verification URL to validate this payout:", MG, y, { width: CW - qrW - 16 });
      y += 14;

      if (slip.verificationUrl) {
        doc.fillColor(C.brand).fontSize(7).font("Helvetica")
           .text(slip.verificationUrl, MG, y, { width: CW - qrW - 16 });
        y += 14;
      }

      // QR code image
      if (qrBuf) {
        doc.image(qrBuf, qrX, verY, { width: qrW, height: qrW });
      }

      y = Math.max(y, verY + qrW + 8);
      hrule(doc, MG, y, CW, C.border, 1);
      y += 12;
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    const footerH = 58;
    const footerY = H - footerH;

    doc.rect(0, footerY, W, footerH).fill(C.lightBg);
    hrule(doc, 0, footerY, W, C.border, 0.7);

    doc.fillColor(C.dark).fontSize(8).font("Helvetica-Bold")
       .text(
         "This is a system-generated RasoKart Payout transaction slip. No signature is required.",
         MG, footerY + 10,
         { width: CW, align: "center" }
       );

    const contactParts: string[] = [];
    if (slip.supportEmail) contactParts.push(`Support: ${slip.supportEmail}`);
    if (slip.supportPhone) contactParts.push(`Phone: ${slip.supportPhone}`);
    const contactLine = contactParts.length > 0 ? contactParts.join("  |  ") : "RasoKart Customer Support";

    doc.fillColor(C.mutedText).fontSize(7.5).font("Helvetica")
       .text(contactLine, MG, footerY + 26, { width: CW, align: "center" });

    doc.fillColor(C.mutedText).fontSize(7).font("Helvetica")
       .text(
         `Generated: ${slip.generatedAt}  ·  Operated by Nickey Collection Private Limited  ·  Page 1 of 1`,
         MG, footerY + 42,
         { width: CW, align: "center" }
       );

    doc.end();
  });
}
