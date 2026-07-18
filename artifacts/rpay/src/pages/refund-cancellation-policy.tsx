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
  RotateCcw,
  XCircle,
  Clock,
  DollarSign,
  AlertTriangle,
  Phone,
  FileText,
  CheckCircle,
  Ban,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "service-cancellation", icon: XCircle, title: "Service Cancellation", color: "text-red-400" },
  { id: "platform-fee-refunds", icon: RotateCcw, title: "Platform Fee Refunds", color: "text-violet-400" },
  { id: "transaction-refunds", icon: DollarSign, title: "Transaction Refunds", color: "text-emerald-400" },
  { id: "timelines", icon: Clock, title: "Refund Timelines", color: "text-amber-400" },
  { id: "non-refundable", icon: Ban, title: "Non-Refundable Items", color: "text-orange-400" },
  { id: "failed-transactions", icon: AlertTriangle, title: "Failed Transactions", color: "text-yellow-400" },
  { id: "how-to-request", icon: CheckCircle, title: "How to Request a Refund", color: "text-teal-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function RefundCancellationPolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Refund Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Refund & Cancellation Policy describes the conditions under which{" "}
          <strong className="text-foreground">{companyName}</strong> ("RasoKart") processes refunds and
          cancellations on the RasoKart payment gateway platform. Please read this policy carefully
          before using the Platform.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          RasoKart provides payment gateway infrastructure services to registered merchants. This policy
          addresses two distinct types of refunds:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/50 bg-card/40 p-4">
            <p className="text-sm font-semibold text-foreground mb-2">Platform Subscription Fees</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Fees charged by RasoKart to merchants for use of the platform and its services (e.g., monthly
              subscription, setup charges).
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-4">
            <p className="text-sm font-semibold text-foreground mb-2">Merchant-Initiated Customer Refunds</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Refunds issued by a merchant to their end customers for transactions collected through the
              Platform. RasoKart facilitates such refunds as a technical service.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Service Cancellation */}
      <section>
        <SectionAnchor id="service-cancellation" />
        <SectionHeading icon={XCircle} title="2. Service Cancellation" color="text-red-400" id="service-cancellation" />
        <ul className="space-y-2 mb-4">
          <Bullet>You may cancel your RasoKart merchant account at any time by contacting our support team</Bullet>
          <Bullet>Cancellation requests should be submitted with a minimum of 7 days' notice before the next billing cycle</Bullet>
          <Bullet>Upon cancellation, access to the Platform will continue until the end of the current paid billing period</Bullet>
          <Bullet>All pending settlements will be processed within the standard settlement timelines after cancellation</Bullet>
          <Bullet>Any outstanding chargebacks, disputes, or compliance holds may delay final settlement after account closure</Bullet>
          <Bullet>We reserve the right to retain necessary data and records for a period required by applicable law after account closure</Bullet>
        </ul>
      </section>

      {/* 3. Platform Fee Refunds */}
      <section>
        <SectionAnchor id="platform-fee-refunds" />
        <SectionHeading icon={RotateCcw} title="3. Platform Fee Refunds" color="text-violet-400" id="platform-fee-refunds" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Platform subscription fees are generally non-refundable. Refunds of platform fees may be considered
          in the following limited circumstances:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>
            <strong className="text-foreground">Billing error:</strong> Where you were incorrectly charged due
            to a technical or billing error on our part — the overcharge will be refunded or credited
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Service non-availability:</strong> If the Platform was
            unavailable for extended periods (beyond our published SLA) due to our fault, a prorated credit
            may be issued at our discretion
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Duplicate charges:</strong> If you were charged twice for the
            same billing period, the duplicate payment will be refunded
          </Bullet>
        </ul>
        <InfoBox variant="warning">
          All refund requests for platform fees must be submitted within 30 days of the charge date. We will
          review each request on a case-by-case basis.
        </InfoBox>
      </section>

      {/* 4. Transaction Refunds */}
      <section>
        <SectionAnchor id="transaction-refunds" />
        <SectionHeading icon={DollarSign} title="4. Merchant-Initiated Customer Refunds" color="text-emerald-400" id="transaction-refunds" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Merchants may initiate refunds to their customers for payments collected through the Platform,
          subject to the following:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Refunds can be initiated from the merchant dashboard or via the API for eligible transactions</Bullet>
          <Bullet>The refund amount cannot exceed the original transaction amount</Bullet>
          <Bullet>Partial refunds are supported for most payment methods</Bullet>
          <Bullet>Transaction processing fees deducted at the time of original collection are generally not refunded when a transaction is refunded</Bullet>
          <Bullet>Refund eligibility is subject to time limits that vary by payment method — typically up to 180 days from the original transaction date</Bullet>
          <Bullet>We pass on refunds to your customers on your behalf; you are responsible for your own refund policy and communicating it to your customers</Bullet>
        </ul>
      </section>

      {/* 5. Timelines */}
      <section>
        <SectionAnchor id="timelines" />
        <SectionHeading icon={Clock} title="5. Refund Processing Timelines" color="text-amber-400" id="timelines" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Once a refund is successfully initiated and approved, the estimated credit timelines to the original
          payment source are:
        </p>
        <div className="space-y-3">
          {[
            { method: "UPI", timeline: "Typically within 1–3 business days" },
            { method: "Net Banking", timeline: "Typically within 3–5 business days" },
            { method: "Debit Card", timeline: "Typically within 5–7 business days" },
            { method: "Credit Card", timeline: "Typically within 5–10 business days (depends on card-issuing bank)" },
            { method: "Wallet Transfers / NEFT / RTGS", timeline: "Typically within 1–3 business days" },
          ].map((r) => (
            <div key={r.method} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <span className="text-sm font-medium text-foreground">{r.method}</span>
              <span className="text-xs text-muted-foreground">{r.timeline}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
          These timelines are indicative and actual credit may vary based on your customer's bank processing
          times. RasoKart is not responsible for delays caused by the customer's bank or financial institution.
        </p>
      </section>

      {/* 6. Non-Refundable Items */}
      <section>
        <SectionAnchor id="non-refundable" />
        <SectionHeading icon={Ban} title="6. Non-Refundable Items" color="text-orange-400" id="non-refundable" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          The following are not eligible for refund:
        </p>
        <ul className="space-y-2">
          <Bullet>Transaction processing fees already deducted from a settled or refunded transaction</Bullet>
          <Bullet>Platform subscription fees for consumed billing periods, except in the case of billing error</Bullet>
          <Bullet>Chargeback-related penalties and dispute resolution fees</Bullet>
          <Bullet>Setup, onboarding, or integration fees where services have been rendered</Bullet>
          <Bullet>Funds that have been fraudulently obtained or involved in AML/CFT violations</Bullet>
          <Bullet>Any amounts already subject to a court order, regulatory freeze, or legal hold</Bullet>
        </ul>
      </section>

      {/* 7. Failed Transactions */}
      <section>
        <SectionAnchor id="failed-transactions" />
        <SectionHeading icon={AlertTriangle} title="7. Failed Transactions" color="text-yellow-400" id="failed-transactions" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          In the event that a customer's payment is debited but the transaction is not recorded as successful on the Platform:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Funds deducted from a customer's account for a failed transaction are typically auto-reversed by the acquiring bank or payment network within 5–7 business days</Bullet>
          <Bullet>If the amount is not auto-reversed within 10 business days, the customer or merchant should contact us with the transaction details</Bullet>
          <Bullet>We will liaise with our banking partners to investigate and facilitate the refund of genuinely failed transactions</Bullet>
        </ul>
        <InfoBox variant="warning">
          RasoKart does not hold funds for failed transactions. The timeline for auto-reversal depends on the
          customer's bank. We will assist with investigations but cannot guarantee outcomes within timelines
          controlled by third-party banks.
        </InfoBox>
      </section>

      {/* 8. How to Request */}
      <section>
        <SectionAnchor id="how-to-request" />
        <SectionHeading icon={CheckCircle} title="8. How to Request a Refund" color="text-teal-400" id="how-to-request" />
        <div className="space-y-3">
          {[
            { step: "1", title: "Merchant Dashboard", desc: "Log in to your RasoKart merchant portal and navigate to the relevant transaction to initiate a customer refund directly." },
            { step: "2", title: "Platform Fee Refund", desc: "Contact our support team with your account details, transaction ID, and the reason for the refund request." },
            { step: "3", title: "Failed Transaction", desc: "Email or call our support team with the customer's payment details, amount, date, and any reference number available." },
            { step: "4", title: "Review Process", desc: "We will review your request and respond within 3 business days. Complex cases may take longer and will be communicated accordingly." },
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

      {/* 9. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="9. Contact Us" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
          <p className="text-sm text-muted-foreground">
            P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan
          </p>
          {supportPhone && (
            <a href={`tel:${supportPhone}`} className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
              Phone: {supportPhone}
            </a>
          )}
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
              Email: {supportEmail}
            </a>
          )}
          <div className="pt-1">
            <Link href="/contact-us" className="text-sm text-primary hover:underline">
              Submit a query via our Contact Us page →
            </Link>
          </div>
        </div>
      </section>
    </LegalLayout>
  );
}
