import { Link } from "wouter";
import LegalLayout, {
  Bullet,
  InfoBox,
  SectionAnchor,
  SectionHeading,
  type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  CreditCard,
  DollarSign,
  Clock,
  AlertTriangle,
  Shield,
  RotateCcw,
  Lock,
  Phone,
  FileText,
  Settings,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "payment-collection", icon: CreditCard, title: "Payment Collection", color: "text-violet-400" },
  { id: "payout-processing", icon: DollarSign, title: "Payout Processing", color: "text-emerald-400" },
  { id: "settlement-cycle", icon: Clock, title: "Settlement Cycle", color: "text-amber-400" },
  { id: "holds-reserves", icon: Lock, title: "Holds & Reserves", color: "text-orange-400" },
  { id: "reconciliation", icon: RotateCcw, title: "Reconciliation", color: "text-blue-400" },
  { id: "failed-transactions", icon: AlertTriangle, title: "Failed Transactions", color: "text-yellow-400" },
  { id: "refunds-reversals", icon: RotateCcw, title: "Refunds & Reversals", color: "text-rose-400" },
  { id: "disputes", icon: Shield, title: "Disputes", color: "text-indigo-400" },
  { id: "limitations", icon: Settings, title: "Limitations & Controls", color: "text-muted-foreground" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function PaymentPayoutSettlementPolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Payment, Payout & Settlement Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Payment Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This policy describes how <strong className="text-foreground">{companyName}</strong> ("RasoKart")
          handles payment collection, payout disbursement, settlement of funds, reconciliation, and related
          processes on the Platform. Understanding this policy ensures smooth financial operations for
          your business.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart facilitates the collection of payments from your customers on your behalf and the
          subsequent disbursement (settlement) of those funds to your registered bank account, net of
          applicable fees and deductions. The Platform also supports merchant-initiated payouts to
          third-party beneficiaries on eligible plans.
        </p>
      </section>

      {/* 2. Payment Collection */}
      <section>
        <SectionAnchor id="payment-collection" />
        <SectionHeading icon={CreditCard} title="2. Payment Collection" color="text-violet-400" id="payment-collection" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Customers can make payments to merchants through the following instruments supported on the
          Platform:
        </p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          {[
            { method: "UPI (Unified Payments Interface)", desc: "Via QR codes, UPI IDs, or VPA aliases. Real-time payment confirmation." },
            { method: "NEFT / RTGS / IMPS", desc: "Via virtual account numbers assigned to the merchant. Suitable for larger transfers." },
            { method: "Payment Links", desc: "Shareable links that redirect the payer to a hosted payment page." },
            { method: "QR Code", desc: "Static and dynamic QR codes for in-person and digital UPI collections." },
            { method: "API-based Collection", desc: "Programmatic order creation and payment capture via the RasoKart API (eligible plans)." },
          ].map((m) => (
            <div key={m.method} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{m.method}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
        <ul className="space-y-2">
          <Bullet>Payment collection is subject to applicable network, bank, and instrument availability</Bullet>
          <Bullet>Transaction limits may apply per payment instrument and per day</Bullet>
          <Bullet>Collected funds are held in a designated account pending settlement to the merchant</Bullet>
        </ul>
      </section>

      {/* 3. Payout Processing */}
      <section>
        <SectionAnchor id="payout-processing" />
        <SectionHeading icon={DollarSign} title="3. Payout Processing (Merchant-to-Beneficiary)" color="text-emerald-400" id="payout-processing" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Merchants on eligible plans (Gold and above) can initiate payouts to registered beneficiaries
          via the Payout API or dashboard. Key aspects:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Beneficiaries must be registered and verified in your merchant dashboard before initiating a payout</Bullet>
          <Bullet>Payouts are subject to daily and per-transaction limits based on your plan and risk profile</Bullet>
          <Bullet>Payout requests are processed on business days subject to banking partner availability</Bullet>
          <Bullet>You are responsible for the accuracy of beneficiary bank details — we are not liable for funds transferred to incorrect accounts provided by you</Bullet>
          <Bullet>Payout status updates are available in real time via the dashboard and webhook callbacks</Bullet>
          <Bullet>Payout fees may apply and will be deducted from your wallet balance before disbursement</Bullet>
        </ul>
        <InfoBox variant="warning">
          Payouts are available only on Gold, Platinum, Enterprise, and Custom plans. Starter and Silver
          plan merchants do not have access to the Payout API.
        </InfoBox>
      </section>

      {/* 4. Settlement Cycle */}
      <section>
        <SectionAnchor id="settlement-cycle" />
        <SectionHeading icon={Clock} title="4. Settlement Cycle" color="text-amber-400" id="settlement-cycle" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          The settlement cycle is the timeline for transfer of collected payment funds from the Platform
          to your registered bank account. Standard cycles are:
        </p>
        <div className="space-y-2 mb-4">
          {[
            { plan: "Starter", cycle: "T+3 business days" },
            { plan: "Silver", cycle: "T+2 business days" },
            { plan: "Gold / Platinum", cycle: "T+1 business day" },
            { plan: "Enterprise / Custom", cycle: "As per agreement" },
          ].map((r) => (
            <div key={r.plan} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-4 py-2.5">
              <span className="text-sm text-foreground">{r.plan}</span>
              <span className="text-sm font-semibold text-amber-400">{r.cycle}</span>
            </div>
          ))}
        </div>
        <ul className="space-y-2">
          <Bullet>Settlement is processed to your registered, KYC-verified bank account only</Bullet>
          <Bullet>Weekends and public holidays are excluded from settlement timelines</Bullet>
          <Bullet>Settlement amounts reflect gross collected amount minus applicable fees, chargebacks, and deductions</Bullet>
          <Bullet>A settlement report is available in your dashboard for every settlement cycle</Bullet>
        </ul>
      </section>

      {/* 5. Holds & Reserves */}
      <section>
        <SectionAnchor id="holds-reserves" />
        <SectionHeading icon={Lock} title="5. Holds & Reserves" color="text-orange-400" id="holds-reserves" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          We may place holds on settlement or require a reserve in the following circumstances:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Suspected fraudulent activity or unusual transaction patterns detected</Bullet>
          <Bullet>Excessive chargeback rate or ongoing dispute investigations</Bullet>
          <Bullet>Regulatory enquiry, legal hold, or compliance review</Bullet>
          <Bullet>Outstanding fees, penalties, or obligations owed to us</Bullet>
          <Bullet>Account suspension pending investigation</Bullet>
          <Bullet>New merchant accounts may be subject to a rolling reserve during initial onboarding</Bullet>
        </ul>
        <InfoBox variant="warning">
          We will notify you of any hold placed on your settlement as soon as practicable, except where
          legally prohibited from doing so (e.g., in the case of a regulatory investigation or law
          enforcement order).
        </InfoBox>
      </section>

      {/* 6. Reconciliation */}
      <section>
        <SectionAnchor id="reconciliation" />
        <SectionHeading icon={RotateCcw} title="6. Reconciliation" color="text-blue-400" id="reconciliation" />
        <ul className="space-y-2 mb-4">
          <Bullet>The Platform provides an automated reconciliation engine that matches collected deposits against settlements</Bullet>
          <Bullet>Reconciliation reports are available in your merchant dashboard and can be exported</Bullet>
          <Bullet>Discrepancies identified in reconciliation should be raised with our support team within 30 days of the relevant settlement date</Bullet>
          <Bullet>We will investigate and resolve confirmed reconciliation discrepancies within a reasonable time</Bullet>
        </ul>
      </section>

      {/* 7. Failed Transactions */}
      <section>
        <SectionAnchor id="failed-transactions" />
        <SectionHeading icon={AlertTriangle} title="7. Failed Transactions" color="text-yellow-400" id="failed-transactions" />
        <ul className="space-y-2">
          <Bullet>Failed transactions where a customer's account was debited but the payment was not confirmed are subject to auto-reversal by the customer's bank within 5–7 business days</Bullet>
          <Bullet>If an auto-reversal does not occur within 10 business days, contact us with the transaction details</Bullet>
          <Bullet>Funds from genuinely failed transactions are not retained by RasoKart and will be returned to the customer's source account</Bullet>
        </ul>
      </section>

      {/* 8. Refunds & Reversals */}
      <section>
        <SectionAnchor id="refunds-reversals" />
        <SectionHeading icon={RotateCcw} title="8. Refunds & Reversals" color="text-rose-400" id="refunds-reversals" />
        <ul className="space-y-2 mb-4">
          <Bullet>Merchants can initiate customer refunds from the dashboard or API for eligible transactions</Bullet>
          <Bullet>Refund amounts are deducted from your available settlement balance or next settlement cycle</Bullet>
          <Bullet>Transaction processing fees are generally not refunded when a transaction is refunded</Bullet>
          <Bullet>Refund timelines depend on the payment instrument (see our Refund & Cancellation Policy for timelines)</Bullet>
        </ul>
        <p className="text-muted-foreground text-sm">
          Full details in our{" "}
          <Link href="/refund-cancellation-policy" className="text-primary hover:underline">
            Refund & Cancellation Policy
          </Link>
          .
        </p>
      </section>

      {/* 9. Disputes */}
      <section>
        <SectionAnchor id="disputes" />
        <SectionHeading icon={Shield} title="9. Disputes" color="text-indigo-400" id="disputes" />
        <p className="text-muted-foreground text-sm mb-4">
          For payment disputes between merchants and customers, or between merchants and RasoKart:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Merchant-customer disputes should be resolved directly between the parties; RasoKart may assist in providing transaction evidence</Bullet>
          <Bullet>Chargeback disputes require merchant response within the timeframe specified in our Chargeback & Dispute Policy</Bullet>
          <Bullet>Disputes with RasoKart regarding settlement amounts should be raised within 30 days of the settlement date</Bullet>
        </ul>
      </section>

      {/* 10. Limitations */}
      <section>
        <SectionAnchor id="limitations" />
        <SectionHeading icon={Settings} title="10. Limitations & Controls" color="text-muted-foreground" id="limitations" />
        <ul className="space-y-2">
          <Bullet>Daily and monthly transaction limits may be set based on your plan, KYC status, and risk profile</Bullet>
          <Bullet>We may impose additional controls during events, promotions, or periods of elevated transaction volumes</Bullet>
          <Bullet>Transaction limits and controls may be adjusted with prior notice or, in cases of fraud risk, without prior notice</Bullet>
        </ul>
      </section>

      {/* 11. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="11. Contact Us" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
          {supportPhone && (
            <a href={`tel:${supportPhone}`} className="block text-sm text-muted-foreground hover:text-foreground">
              Phone: {supportPhone}
            </a>
          )}
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className="block text-sm text-muted-foreground hover:text-foreground">
              Email: {supportEmail}
            </a>
          )}
          <Link href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            Submit a query via Contact Us →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
