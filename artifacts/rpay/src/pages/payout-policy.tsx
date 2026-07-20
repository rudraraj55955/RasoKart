import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  FileText, Wallet, Clock, CreditCard, AlertTriangle, Shield, Scale, Phone, Ban, Settings,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "eligibility", icon: Shield, title: "Eligibility", color: "text-violet-400" },
  { id: "payout-modes", icon: Wallet, title: "Payout Modes", color: "text-blue-400" },
  { id: "processing-times", icon: Clock, title: "Processing Times", color: "text-emerald-400" },
  { id: "fees-limits", icon: CreditCard, title: "Fees & Transaction Limits", color: "text-amber-400" },
  { id: "verification", icon: Settings, title: "Verification & Compliance", color: "text-orange-400" },
  { id: "failures", icon: Ban, title: "Failed & Rejected Payouts", color: "text-rose-400" },
  { id: "disputes", icon: AlertTriangle, title: "Disputes & Reversals", color: "text-red-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function PayoutPolicy() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "Payout Policy — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Payout Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Payout Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Payout Policy governs the disbursement of funds from merchant wallets and payout merchant accounts via the RasoKart platform, operated by <strong className="text-foreground">{companyName}</strong>. All payout merchants, merchants, and agents must comply with this policy.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart's payout service allows authorised merchants and payout merchants to disburse funds to bank accounts, UPI handles, and other permitted destinations within India. Payout services are subject to RBI's Payment and Settlement Systems Act 2007, PMLA 2002, and all applicable guidelines.
        </p>
        <InfoBox>
          All payouts are subject to KYC verification of the account holder and beneficiary. RasoKart does not support international payouts at this time.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="eligibility" />
        <SectionHeading icon={Shield} title="Eligibility" color="text-violet-400" id="eligibility" />
        <p className="text-muted-foreground text-sm leading-relaxed">To access payout services, you must:</p>
        <ul className="space-y-2">
          {[
            "Have a verified payout merchant account or an eligible merchant account with payout access enabled",
            "Have completed full KYC verification, including PAN, Aadhaar, and bank account verification",
            "Have sufficient wallet balance to cover the payout amount plus applicable fees",
            "Be in good standing with no active disputes, fraud flags, or compliance holds on your account",
            "Ensure all beneficiary details are accurate and the beneficiary bank account is active",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="payout-modes" />
        <SectionHeading icon={Wallet} title="Payout Modes" color="text-blue-400" id="payout-modes" />
        <p className="text-muted-foreground text-sm leading-relaxed">RasoKart supports the following payout modes (subject to availability and your account configuration):</p>
        <ul className="space-y-2">
          {[
            "IMPS (Immediate Payment Service) — available 24/7, typically instant",
            "NEFT (National Electronic Funds Transfer) — processed in RBI batch windows",
            "RTGS (Real Time Gross Settlement) — for high-value transactions above ₹2 lakh",
            "UPI (Unified Payments Interface) — instant transfer to any UPI-registered handle",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The available modes for your account depend on your plan, wallet balance, and transaction history. RasoKart may update supported payout modes with prior notice.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="processing-times" />
        <SectionHeading icon={Clock} title="Processing Times" color="text-emerald-400" id="processing-times" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-4 font-medium text-foreground">Mode</th>
                <th className="text-left py-2 pr-4 font-medium text-foreground">Typical Time</th>
                <th className="text-left py-2 font-medium text-foreground">Availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["IMPS", "Instant – 30 minutes", "24×7, 365 days"],
                ["UPI", "Instant – 5 minutes", "24×7, 365 days"],
                ["NEFT", "30 min – 4 hours", "Mon–Sat, 8 AM – 7 PM (per RBI batches)"],
                ["RTGS", "30 min – 2 hours", "Mon–Sat, 7 AM – 6 PM"],
              ].map(([mode, time, avail]) => (
                <tr key={mode}>
                  <td className="py-2 pr-4 font-medium text-foreground">{mode}</td>
                  <td className="py-2 pr-4">{time}</td>
                  <td className="py-2">{avail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <InfoBox variant="warning">
          Processing times are estimates and depend on the beneficiary bank's processing speed, RBI batch schedules, and any compliance holds. RasoKart is not liable for delays caused by third-party payment networks or beneficiary banks.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="fees-limits" />
        <SectionHeading icon={CreditCard} title="Fees & Transaction Limits" color="text-amber-400" id="fees-limits" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Payout fees vary by plan and payout mode. Applicable fees are displayed in your dashboard before confirming a payout. Current fee structures are published in our <Link href="/pricing-fees-settlement-policy" className="text-primary hover:underline">Pricing & Fees Policy</Link>.
        </p>
        <ul className="space-y-2">
          {[
            "Transaction limits are set per account based on KYC level, business category, and plan",
            "Daily and monthly payout limits apply; higher limits may be available on request with enhanced KYC",
            "Minimum payout amount: ₹1.00 (subject to mode-specific minimums)",
            "Maximum single transaction: as per your plan and RBI/provider limits",
            "Bulk payout limits are configured separately; contact us to enable bulk payouts",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="verification" />
        <SectionHeading icon={Settings} title="Verification & Compliance" color="text-orange-400" id="verification" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          All payout requests are subject to automated compliance screening. RasoKart may:
        </p>
        <ul className="space-y-2">
          {[
            "Hold or delay payouts pending verification of beneficiary details or source of funds",
            "Require additional documentation for unusually large or high-frequency payout patterns",
            "Reject payouts to accounts flagged as high-risk or appearing on regulatory watchlists",
            "Report suspicious payout activity to FIU-IND and other regulatory bodies as required by law",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="failures" />
        <SectionHeading icon={Ban} title="Failed & Rejected Payouts" color="text-rose-400" id="failures" />
        <p className="text-muted-foreground text-sm leading-relaxed">Payouts may fail or be rejected due to:</p>
        <ul className="space-y-2">
          {[
            "Invalid or closed beneficiary bank account or UPI ID",
            "Incorrect IFSC code or account number",
            "Bank-side technical failures or downtime",
            "Compliance holds triggered by our fraud detection systems",
            "Insufficient wallet balance at the time of processing",
            "Beneficiary account's daily or monthly receipt limits being exceeded",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Failed payout amounts are typically reversed to your wallet within 1–3 business days. You will be notified via your dashboard and registered email. Please verify beneficiary details before retrying.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="disputes" />
        <SectionHeading icon={AlertTriangle} title="Disputes & Reversals" color="text-red-400" id="disputes" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Once a payout is initiated and confirmed by the payment network, it cannot be recalled by RasoKart. If a payout is disputed:
        </p>
        <ul className="space-y-2">
          {[
            "Contact our support team immediately with the payout reference number and transaction details",
            "We will investigate and coordinate with the beneficiary bank or UPI provider where possible",
            "Reversals are only possible in limited circumstances and at the discretion of the beneficiary bank",
            "You are responsible for verifying beneficiary details before initiating any payout",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For detailed dispute resolution procedures, see our <Link href="/chargeback-dispute-policy" className="text-primary hover:underline">Chargeback & Dispute Policy</Link>.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This policy is governed by the laws of India, including the Payment and Settlement Systems Act 2007, PMLA 2002, and all RBI guidelines applicable to payment aggregators. Disputes are subject to the jurisdiction of courts in Jaipur, Rajasthan, India.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Support: </span><a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a></p>
          {supportPhone && <p><span className="text-muted-foreground">Phone: </span><a href={`tel:${supportPhone}`} className="text-primary hover:underline">{supportPhone}</a></p>}
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/payment-payout-settlement-policy" className="text-primary hover:underline">Settlement Policy</Link> ·{" "}
            <Link href="/chargeback-dispute-policy" className="text-primary hover:underline">Dispute Policy</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
