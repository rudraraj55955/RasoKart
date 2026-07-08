import PDFDocument from "pdfkit";

export type PayoutDisplayStatus = "SUCCESS" | "FAILED" | "REJECTED" | "PROCESSING";

export interface PayoutSlipData {
  id: number;
  receiptId: string;
  generatedAt: string;
  merchant: { businessName: string };
  amount: number;
  currency: string;
  payoutMode: string;
  displayStatus: PayoutDisplayStatus;
  statusLabel: string;
  utr: string | null;
  safeFailureReason: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  processedAt: string | null;
  beneficiary: {
    name: string | null;
    bankName: string | null;
    maskedAccount: string | null;
    ifscCode: string | null;
    maskedUpi: string | null;
  };
  remarks: string | null;
  isNotFinal: boolean;
  walletRefunded: boolean;
}

// ── Colours ────────────────────────────────────────────────────────────────────
const C = {
  navy:       "#0f172a",
  navyLight:  "#1e293b",
  border:     "#334155",
  mutedText:  "#64748b",
  bodyText:   "#1e293b",
  white:      "#ffffff",

  successBg:  "#f0fdf4",
  successText:"#166534",
  failBg:     "#fff1f2",
  failText:   "#991b1b",
  rejectBg:   "#fff7ed",
  rejectText: "#9a3412",
  procBg:     "#fffbeb",
  procText:   "#92400e",
};

function statusColours(status: PayoutDisplayStatus) {
  switch (status) {
    case "SUCCESS":    return { bg: C.successBg, fg: C.successText, label: "● Payout Sent" };
    case "FAILED":     return { bg: C.failBg,    fg: C.failText,    label: "✕ Payout Failed" };
    case "REJECTED":   return { bg: C.rejectBg,  fg: C.rejectText,  label: "✕ Payout Rejected" };
    case "PROCESSING": return { bg: C.procBg,    fg: C.procText,    label: "⟳ Payout Processing" };
  }
}

function fmtInr(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawHRule(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number) {
  doc.moveTo(x, y).lineTo(x + w, y).strokeColor(C.border).lineWidth(0.5).stroke();
}

function sectionLabel(doc: InstanceType<typeof PDFDocument>, text: string, x: number, y: number, w: number) {
  doc.rect(x, y, w, 18).fill(C.navyLight);
  doc.fillColor(C.white).fontSize(7).font("Helvetica-Bold")
     .text(text.toUpperCase(), x + 8, y + 5, { width: w - 16 });
}

function kv(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
  value: string | null | undefined,
  x: number,
  y: number,
  labelW: number,
  valueW: number,
) {
  const displayValue = value ?? "—";
  doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
     .text(label, x, y, { width: labelW, lineBreak: false });
  doc.fillColor(C.bodyText).fontSize(8).font("Helvetica-Bold")
     .text(displayValue, x + labelW, y, { width: valueW, lineBreak: false });
  return y + 16;
}

export function buildPayoutSlipPdf(slip: PayoutSlipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W  = doc.page.width;   // 595.28
    const MG = 40;
    const CW = W - MG * 2;       // 515.28

    // ── 1. Header ─────────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 100).fill(C.navy);

    doc.fillColor(C.white).fontSize(22).font("Helvetica-Bold")
       .text("RasoKart", MG, 26, { lineBreak: false });
    doc.fillColor("#94a3b8").fontSize(9).font("Helvetica")
       .text("Payout Receipt", MG, 54);

    doc.fillColor(C.white).fontSize(9).font("Helvetica-Bold")
       .text(slip.receiptId, MG, 26, { width: CW, align: "right", lineBreak: false });
    doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
       .text(`Generated: ${slip.generatedAt}`, MG, 42, { width: CW, align: "right" });

    let y = 112;

    // ── 2. Status Banner ──────────────────────────────────────────────────────
    const sc = statusColours(slip.displayStatus);
    doc.rect(MG, y, CW, 36).fill(sc.bg);
    doc.fillColor(sc.fg).fontSize(11).font("Helvetica-Bold")
       .text(sc.label, MG + 14, y + 11, { width: CW - 28, lineBreak: false });
    if (slip.isNotFinal) {
      doc.fillColor(C.procText).fontSize(8).font("Helvetica")
         .text("NOT FINAL — status may change", MG + 14, y + 11, { width: CW - 28, align: "right", lineBreak: false });
    }
    y += 44;

    // ── 3. Merchant + Payout summary strip ────────────────────────────────────
    doc.rect(MG, y, CW, 28).fill("#f8fafc");
    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
       .text("Merchant", MG + 12, y + 8, { lineBreak: false });
    doc.fillColor(C.bodyText).fontSize(9).font("Helvetica-Bold")
       .text(slip.merchant.businessName, MG + 70, y + 7, { lineBreak: false });
    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
       .text(fmtInr(slip.amount), MG + 12, y + 8, { width: CW - 24, align: "right", lineBreak: false });
    y += 36;

    // ── 4. Payout Details + Beneficiary (two columns) ─────────────────────────
    const COL1 = MG;
    const COL1W = CW * 0.52;
    const COL2 = MG + COL1W + 12;
    const COL2W = CW - COL1W - 12;
    const LBL_W = 100;

    // Section headers
    sectionLabel(doc, "Payout Details",     COL1, y, COL1W);
    sectionLabel(doc, "Beneficiary Details", COL2, y, COL2W);
    y += 24;

    let yL = y;
    let yR = y;

    // Left column — payout details
    yL = kv(doc, "Payout ID",      `#${slip.id}`,         COL1, yL, LBL_W, COL1W - LBL_W);
    yL = kv(doc, "Mode",           slip.payoutMode,        COL1, yL, LBL_W, COL1W - LBL_W);
    yL = kv(doc, "Requested On",   slip.requestedAt,       COL1, yL, LBL_W, COL1W - LBL_W);
    yL = kv(doc, "Updated On",     slip.processedAt,       COL1, yL, LBL_W, COL1W - LBL_W);
    if (slip.utr) {
      yL = kv(doc, "UTR / Reference", slip.utr,            COL1, yL, LBL_W, COL1W - LBL_W);
    }
    if (slip.remarks) {
      yL = kv(doc, "Remarks",      slip.remarks,           COL1, yL, LBL_W, COL1W - LBL_W);
    }

    // Right column — beneficiary details
    const { name, bankName, maskedAccount, ifscCode, maskedUpi } = slip.beneficiary;
    const BLBL = 82;
    yR = kv(doc, "Name",    name,           COL2, yR, BLBL, COL2W - BLBL);
    if (maskedUpi) {
      yR = kv(doc, "UPI ID", maskedUpi,     COL2, yR, BLBL, COL2W - BLBL);
    } else {
      yR = kv(doc, "Bank",   bankName,       COL2, yR, BLBL, COL2W - BLBL);
      yR = kv(doc, "Account",maskedAccount,  COL2, yR, BLBL, COL2W - BLBL);
      yR = kv(doc, "IFSC",   ifscCode,       COL2, yR, BLBL, COL2W - BLBL);
    }

    y = Math.max(yL, yR) + 8;
    drawHRule(doc, MG, y, CW);
    y += 12;

    // ── 5. Status details section ─────────────────────────────────────────────
    if (slip.safeFailureReason || slip.rejectionReason || slip.walletRefunded) {
      sectionLabel(doc, "Status Details", MG, y, CW);
      y += 24;
      const DLBL = 130;

      if (slip.safeFailureReason) {
        doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
           .text("Failure Reason", MG, y, { width: DLBL, lineBreak: false });
        doc.fillColor(C.failText).fontSize(8).font("Helvetica-Bold")
           .text(slip.safeFailureReason, MG + DLBL, y, { width: CW - DLBL });
        y += 20;
      }
      if (slip.rejectionReason) {
        doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
           .text("Rejection Reason", MG, y, { width: DLBL, lineBreak: false });
        doc.fillColor(C.rejectText).fontSize(8).font("Helvetica-Bold")
           .text(slip.rejectionReason, MG + DLBL, y, { width: CW - DLBL });
        y += 20;
      }
      if (slip.walletRefunded) {
        doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
           .text("Wallet Reversal", MG, y, { width: DLBL, lineBreak: false });
        doc.fillColor(C.successText).fontSize(8).font("Helvetica-Bold")
           .text("Amount released back to wallet", MG + DLBL, y, { lineBreak: false });
        y += 20;
      }
      drawHRule(doc, MG, y + 4, CW);
      y += 16;
    }

    // ── 6. Charges section ────────────────────────────────────────────────────
    sectionLabel(doc, "Amount Summary", MG, y, CW);
    y += 24;

    const CLBL = 160;
    const CVALX = MG + CLBL;
    const CVALW = CW - CLBL;

    y = kv(doc, "Payout Amount", fmtInr(slip.amount), MG, y, CLBL, CVALW);
    y = kv(doc, "Platform Charges", "Nil", MG, y, CLBL, CVALW);
    drawHRule(doc, MG, y, CW);
    y += 8;
    doc.fillColor(C.bodyText).fontSize(9).font("Helvetica-Bold")
       .text("Net Debit from Wallet", MG, y, { width: CLBL, lineBreak: false });
    doc.fillColor(C.bodyText).fontSize(9).font("Helvetica-Bold")
       .text(fmtInr(slip.amount), CVALX, y, { width: CVALW, lineBreak: false });
    y += 22;

    // ── 7. Footer ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY, W, 60).fill("#f1f5f9");
    drawHRule(doc, 0, footerY, W);

    doc.fillColor(C.mutedText).fontSize(8).font("Helvetica")
       .text(
         "This is a system-generated RasoKart payout receipt. For support, contact RasoKart support.",
         MG, footerY + 14,
         { width: CW, align: "center" }
       );
    doc.fillColor("#94a3b8").fontSize(7)
       .text(
         "RasoKart — Operated by Nickey Collection Private Limited",
         MG, footerY + 32,
         { width: CW, align: "center" }
       );

    doc.end();
  });
}
