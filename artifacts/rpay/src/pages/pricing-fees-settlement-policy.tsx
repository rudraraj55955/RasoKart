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
  DollarSign,
  CreditCard,
  Clock,
  FileText,
  Settings,
  AlertTriangle,
  Phone,
  CheckCircle,
  TrendingUp,
  Percent,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "plans", icon: TrendingUp, title: "Subscription Plans", color: "text-violet-400" },
  { id: "transaction-fees", icon: Percent, title: "Transaction Fees", color: "text-emerald-400" },
  { id: "settlement-cycle", icon: Clock, title: "Settlement Cycle", color: "text-amber-400" },
  { id: "deductions", icon: DollarSign, title: "Deductions & Adjustments", color: "text-orange-400" },
  { id: "gst", icon: CreditCard, title: "GST & Taxes", color: "text-blue-400" },
  { id: "billing", icon: Settings, title: "Billing Cycle", color: "text-indigo-400" },
  { id: "changes", icon: AlertTriangle, title: "Fee Changes", color: "text-yellow-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

const plans = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    highlight: false,
    features: ["Merchant dashboard access", "Manual deposit tracking", "QR code management (limited)", "Email support"],
    noAccess: ["API access", "Webhook support", "Payout API", "Payment links API"],
  },
  {
    name: "Silver",
    price: "₹999",
    period: "/month + GST",
    highlight: false,
    features: ["All Starter features", "API access", "Webhook support", "Payment links", "Standard settlement (T+2)", "Phone support"],
    noAccess: [],
  },
  {
    name: "Gold",
    price: "₹2,499",
    period: "/month + GST",
    highlight: true,
    features: ["All Silver features", "Payout API", "Priority support", "Faster settlement (T+1)", "Advanced reconciliation", "Dedicated account manager"],
    noAccess: [],
  },
  {
    name: "Platinum",
    price: "₹4,999",
    period: "/month + GST",
    highlight: false,
    features: ["All Gold features", "Custom integrations support", "SLA guarantees", "Onboarding assistance", "Custom webhook configurations"],
    noAccess: [],
  },
  {
    name: "Enterprise",
    price: "₹9,999",
    period: "/month + GST",
    highlight: false,
    features: ["All Platinum features", "Dedicated infrastructure", "Custom SLA", "White-glove support", "Custom pricing on volume"],
    noAccess: [],
  },
  {
    name: "Custom",
    price: "Contact us",
    period: "",
    highlight: false,
    features: ["Fully tailored plan", "Volume-based pricing", "Custom features", "Custom integration", "Negotiated settlement terms"],
    noAccess: [],
  },
];

export default function PricingFeesSettlementPolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Pricing, Fees & Settlement Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Pricing Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This policy describes the subscription plans, transaction fees, and settlement terms applicable to
          merchants using the <strong className="text-foreground">RasoKart</strong> payment gateway platform
          operated by <strong className="text-foreground">{companyName}</strong>. All fees are subject to
          applicable taxes.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Access to the RasoKart platform is available through subscription plans designed for businesses of
          different sizes and requirements. In addition to subscription fees, transaction-level charges may
          apply depending on your plan and the payment instruments used. All amounts are in Indian Rupees
          (INR) unless stated otherwise.
        </p>
      </section>

      {/* 2. Plans */}
      <section>
        <SectionAnchor id="plans" />
        <SectionHeading icon={TrendingUp} title="2. Subscription Plans" color="text-violet-400" id="plans" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl border p-4 ${
                plan.highlight
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 bg-card/40"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                  <p className="text-lg font-bold text-foreground mt-0.5">
                    {plan.price}
                    {plan.period && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">{plan.period}</span>
                    )}
                  </p>
                </div>
                {plan.highlight && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    Popular
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
                {plan.noAccess.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground/40 line-through">
                    <span className="w-3 h-3 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <InfoBox variant="warning" >
          Plan features are subject to change. The Starter plan is intended for trial and evaluation purposes.
          API, webhook, and payout access require a paid plan (Silver or above).
        </InfoBox>
      </section>

      {/* 3. Transaction Fees */}
      <section>
        <SectionAnchor id="transaction-fees" />
        <SectionHeading icon={Percent} title="3. Transaction Fees" color="text-emerald-400" id="transaction-fees" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Transaction fees may apply for certain payment instruments and are deducted from the gross collected
          amount before settlement to the merchant's bank account. Specific transaction fee rates are
          communicated at the time of merchant onboarding and may vary based on:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Payment instrument (UPI, NEFT, RTGS, IMPS, debit card, credit card)</Bullet>
          <Bullet>Transaction volume and average ticket size</Bullet>
          <Bullet>Merchant category and risk profile</Bullet>
          <Bullet>Applicable plan and agreed commercial terms</Bullet>
        </ul>
        <InfoBox>
          Exact transaction fee rates applicable to your account are visible in your merchant dashboard under
          your plan details. Contact our team for custom rates on high-volume accounts.
        </InfoBox>
      </section>

      {/* 4. Settlement Cycle */}
      <section>
        <SectionAnchor id="settlement-cycle" />
        <SectionHeading icon={Clock} title="4. Settlement Cycle" color="text-amber-400" id="settlement-cycle" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Collected funds are settled to your registered bank account in accordance with the following
          standard timelines, subject to KYC completion and account standing:
        </p>
        <div className="space-y-3 mb-4">
          {[
            { plan: "Starter", cycle: "T+3 business days", note: "Standard settlement cycle" },
            { plan: "Silver", cycle: "T+2 business days", note: "Standard settlement cycle" },
            { plan: "Gold / Platinum", cycle: "T+1 business day", note: "Priority settlement" },
            { plan: "Enterprise / Custom", cycle: "As per agreement", note: "Negotiated terms" },
          ].map((r) => (
            <div key={r.plan} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{r.plan}</p>
                <p className="text-xs text-muted-foreground">{r.note}</p>
              </div>
              <span className="text-sm font-semibold text-amber-400">{r.cycle}</span>
            </div>
          ))}
        </div>
        <InfoBox variant="warning">
          Settlement timelines may be extended by banking holidays, regulatory holds, compliance reviews, or
          risk management interventions. "T" refers to the transaction date; business days exclude Sundays
          and public holidays.
        </InfoBox>
      </section>

      {/* 5. Deductions */}
      <section>
        <SectionAnchor id="deductions" />
        <SectionHeading icon={DollarSign} title="5. Deductions & Adjustments" color="text-orange-400" id="deductions" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          The following may be deducted from or set off against your settlement amount:
        </p>
        <ul className="space-y-2">
          <Bullet>Transaction processing fees as per your applicable plan</Bullet>
          <Bullet>GST and other applicable taxes on platform fees</Bullet>
          <Bullet>Chargeback amounts and associated chargeback handling fees</Bullet>
          <Bullet>Refund amounts initiated by you for customer transactions</Bullet>
          <Bullet>Any amounts owed to us under these Terms or the Merchant Agreement</Bullet>
          <Bullet>Risk reserve amounts as determined by our risk management policy</Bullet>
        </ul>
      </section>

      {/* 6. GST */}
      <section>
        <SectionAnchor id="gst" />
        <SectionHeading icon={CreditCard} title="6. GST & Taxes" color="text-blue-400" id="gst" />
        <ul className="space-y-2">
          <Bullet>All subscription fees and platform service charges are subject to Goods and Services Tax (GST) at the applicable rate (currently 18% for digital services)</Bullet>
          <Bullet>GST invoices will be issued to your registered business address and GST number as provided in your account profile</Bullet>
          <Bullet>You are responsible for ensuring your GST registration details in your profile are accurate and up-to-date</Bullet>
          <Bullet>TDS (Tax Deducted at Source) deductions made by you on platform fees, if applicable, should be accompanied by Form 16A within the statutory timeline</Bullet>
        </ul>
      </section>

      {/* 7. Billing */}
      <section>
        <SectionAnchor id="billing" />
        <SectionHeading icon={Settings} title="7. Billing Cycle" color="text-indigo-400" id="billing" />
        <ul className="space-y-2 mb-4">
          <Bullet>Subscription fees are billed monthly in advance at the beginning of each billing cycle</Bullet>
          <Bullet>The first billing cycle begins on the date of plan activation</Bullet>
          <Bullet>Subscription fees may be deducted from your settlement balance or charged to your registered payment method</Bullet>
          <Bullet>Invoices are generated electronically and available in your merchant dashboard</Bullet>
          <Bullet>Non-payment of subscription fees may result in suspension of platform access</Bullet>
        </ul>
      </section>

      {/* 8. Fee Changes */}
      <section>
        <SectionAnchor id="changes" />
        <SectionHeading icon={AlertTriangle} title="8. Fee Changes" color="text-yellow-400" id="changes" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          We reserve the right to revise subscription fees, transaction fee rates, and settlement terms. Any
          changes will be communicated with a minimum of 30 days' prior written notice via email or
          in-platform notification. Your continued use of the Platform after the effective date of a fee
          revision constitutes acceptance of the revised terms.
        </p>
        <InfoBox>
          Merchants on long-term or custom agreements will be governed by the fee terms specified in their
          individual agreement, which may override this general policy.
        </InfoBox>
      </section>

      {/* 9. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="9. Contact Us" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
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
          <Link href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            Submit a query via our Contact Us page →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
