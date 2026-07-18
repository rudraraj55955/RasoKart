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
  AlertTriangle,
  FileText,
  Clock,
  ShieldCheck,
  RotateCcw,
  DollarSign,
  Lightbulb,
  Scale,
  Phone,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "what-is-chargeback", icon: FileText, title: "What is a Chargeback?", color: "text-cyan-400" },
  { id: "chargeback-reasons", icon: AlertTriangle, title: "Common Reasons", color: "text-red-400" },
  { id: "process", icon: RotateCcw, title: "Chargeback Process", color: "text-violet-400" },
  { id: "merchant-response", icon: ShieldCheck, title: "Merchant Response", color: "text-emerald-400" },
  { id: "timelines", icon: Clock, title: "Timelines", color: "text-amber-400" },
  { id: "fees", icon: DollarSign, title: "Chargeback Fees", color: "text-orange-400" },
  { id: "prevention", icon: Lightbulb, title: "Prevention Tips", color: "text-yellow-400" },
  { id: "excessive", icon: Scale, title: "Excessive Chargebacks", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function ChargebackDisputePolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Chargeback & Dispute Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Dispute Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This policy explains how <strong className="text-foreground">{companyName}</strong> ("RasoKart")
          handles chargebacks and payment disputes on the Platform, and the obligations of merchants in
          responding to them.
        </p>
      }
    >
      {/* 1. What is a Chargeback */}
      <section>
        <SectionAnchor id="what-is-chargeback" />
        <SectionHeading icon={FileText} title="1. What is a Chargeback?" color="text-cyan-400" id="what-is-chargeback" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          A chargeback occurs when a customer disputes a payment transaction with their bank or card issuer,
          causing the bank to reverse the transaction and reclaim the funds from the merchant. Chargebacks
          are distinct from refunds — they are initiated by the customer's bank and can result in additional
          fees for the merchant.
        </p>
        <InfoBox variant="warning">
          Chargebacks can occur weeks or months after the original transaction. Merchants are required to
          maintain adequate transaction records to defend against invalid chargebacks.
        </InfoBox>
      </section>

      {/* 2. Common Reasons */}
      <section>
        <SectionAnchor id="chargeback-reasons" />
        <SectionHeading icon={AlertTriangle} title="2. Common Chargeback Reasons" color="text-red-400" id="chargeback-reasons" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { reason: "Unauthorised Transaction", desc: "Customer claims they did not authorise the payment (card fraud or account compromise)." },
            { reason: "Item Not Received", desc: "Customer claims the product or service was not delivered." },
            { reason: "Item Significantly Not as Described", desc: "Product/service materially different from what was represented." },
            { reason: "Duplicate Transaction", desc: "Customer was charged more than once for the same transaction." },
            { reason: "Refund Not Processed", desc: "Customer disputes a transaction because a refund was promised but not received." },
            { reason: "Subscription Cancellation", desc: "Customer disputes a recurring charge after cancellation." },
          ].map((r) => (
            <div key={r.reason} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{r.reason}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Process */}
      <section>
        <SectionAnchor id="process" />
        <SectionHeading icon={RotateCcw} title="3. Chargeback Process" color="text-violet-400" id="process" />
        <div className="space-y-3">
          {[
            { step: "1", title: "Customer Dispute Filed", desc: "Customer disputes the transaction with their bank or card issuer." },
            { step: "2", title: "Bank Initiates Chargeback", desc: "The bank reverses the transaction and notifies our payment partners." },
            { step: "3", title: "Merchant Notified", desc: "We notify you via email and dashboard notification about the chargeback, including the amount, reason, and response deadline." },
            { step: "4", title: "Merchant Response", desc: "You submit evidence to dispute the chargeback (if you believe it is invalid) within the specified timeframe." },
            { step: "5", title: "Bank Decision", desc: "The issuing bank reviews the evidence and makes a final decision. This may take 45–90 days." },
            { step: "6", title: "Resolution", desc: "If the chargeback is upheld, the disputed amount is permanently deducted. If reversed in your favour, the funds are reinstated." },
          ].map((s) => (
            <div key={s.step} className="flex gap-4 rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                {s.step}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-0.5">{s.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Merchant Response */}
      <section>
        <SectionAnchor id="merchant-response" />
        <SectionHeading icon={ShieldCheck} title="4. Merchant Response Requirements" color="text-emerald-400" id="merchant-response" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          To successfully dispute a chargeback, you should provide as much of the following evidence as
          applicable:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Order confirmation, invoice, or payment receipt showing the customer's details, order details, and transaction date</Bullet>
          <Bullet>Proof of delivery (tracking number, delivery confirmation, customer signature) for physical goods</Bullet>
          <Bullet>Evidence of digital delivery (download logs, access logs, email delivery confirmation) for digital goods</Bullet>
          <Bullet>Customer communication (emails, chat transcripts) acknowledging receipt or service delivery</Bullet>
          <Bullet>Your merchant's refund policy as communicated to the customer at the time of purchase</Bullet>
          <Bullet>Evidence that the customer's IP address, device, or login matches the disputed transaction</Bullet>
          <Bullet>Any prior communication with the customer regarding the disputed transaction</Bullet>
        </ul>
        <InfoBox>
          Response quality significantly affects chargeback outcomes. Ensure your evidence package is
          complete, organised, and directly addresses the reason for the chargeback.
        </InfoBox>
      </section>

      {/* 5. Timelines */}
      <section>
        <SectionAnchor id="timelines" />
        <SectionHeading icon={Clock} title="5. Chargeback Timelines" color="text-amber-400" id="timelines" />
        <div className="space-y-3">
          {[
            { event: "Chargeback notification to merchant", deadline: "Immediate (email + dashboard)" },
            { event: "Merchant evidence submission deadline", deadline: "Typically 7–15 days from notification" },
            { event: "Bank review period", deadline: "45–90 days from submission" },
            { event: "Maximum chargeback window (customer)", deadline: "Typically up to 120–180 days from original transaction" },
          ].map((t) => (
            <div key={t.event} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <p className="text-sm text-foreground">{t.event}</p>
              <p className="text-xs text-amber-400 font-medium shrink-0 ml-4">{t.deadline}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          Timelines vary by payment method, bank, and card network. Always respond to chargeback
          notifications immediately — missing the response deadline results in automatic chargeback loss.
        </p>
      </section>

      {/* 6. Fees */}
      <section>
        <SectionAnchor id="fees" />
        <SectionHeading icon={DollarSign} title="6. Chargeback Fees" color="text-orange-400" id="fees" />
        <ul className="space-y-2">
          <Bullet>A chargeback handling fee may be charged per chargeback case, regardless of the outcome</Bullet>
          <Bullet>If the chargeback is upheld, the full disputed transaction amount is deducted from your settlement balance or reserve</Bullet>
          <Bullet>Chargeback fees are specified in your merchant onboarding agreement and may vary by plan</Bullet>
          <Bullet>Chargebacks that are resolved in your favour do not incur the chargeback fee, though an administrative processing fee may apply</Bullet>
        </ul>
      </section>

      {/* 7. Prevention */}
      <section>
        <SectionAnchor id="prevention" />
        <SectionHeading icon={Lightbulb} title="7. Chargeback Prevention Tips" color="text-yellow-400" id="prevention" />
        <ul className="space-y-2">
          <Bullet>Clearly communicate your refund and return policy on your website, invoices, and order confirmations</Bullet>
          <Bullet>Use a recognisable business name on payment statements to reduce "I don't recognise this charge" disputes</Bullet>
          <Bullet>Send order confirmations and delivery notifications to customers</Bullet>
          <Bullet>Respond promptly to customer queries and complaints — proactively issue refunds where appropriate to avoid chargebacks</Bullet>
          <Bullet>Keep detailed records of all transactions, customer communications, and delivery confirmations</Bullet>
          <Bullet>Use OTP or two-factor authentication where possible to verify high-value transactions</Bullet>
          <Bullet>For recurring or subscription payments, provide clear cancellation instructions and honour them promptly</Bullet>
        </ul>
      </section>

      {/* 8. Excessive Chargebacks */}
      <section>
        <SectionAnchor id="excessive" />
        <SectionHeading icon={Scale} title="8. Excessive Chargebacks" color="text-indigo-400" id="excessive" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          Merchants with a chargeback rate exceeding acceptable thresholds (typically 1% of transactions
          in any rolling 30-day period) may be subject to:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Enhanced monitoring and review of transactions</Bullet>
          <Bullet>Higher chargeback fees or reserve requirements</Bullet>
          <Bullet>Reduced settlement frequency or increased holds</Bullet>
          <Bullet>Suspension or termination of merchant account</Bullet>
        </ul>
        <InfoBox variant="danger">
          Merchants with persistent high chargeback rates may be reported to industry watchlists maintained
          by payment networks, which can affect your ability to use payment services from other providers.
        </InfoBox>
      </section>

      {/* 9. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="9. Contact Us" color="text-teal-400" id="contact" />
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
