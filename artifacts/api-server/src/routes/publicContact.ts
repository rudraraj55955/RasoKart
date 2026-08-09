import { Router } from "express";
import { db, contactSubmissionsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { ipKeyGenerator } from "express-rate-limit";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { desc } from "drizzle-orm";

const router = Router();

// 5 submissions per IP per 15 minutes — DB-backed so limits persist across instances.
//
// IP resolution strategy (Cloudflare → Nginx → Express):
//
//   We use req.socket.remoteAddress (the actual TCP socket peer, not req.ip
//   which is derived from the client-controllable X-Forwarded-For chain) to
//   decide whether the request arrived through our trusted reverse proxy (Nginx).
//   Only when the socket source matches an IP in RATE_LIMIT_TRUSTED_PROXY_IPS do
//   we accept CF-Connecting-IP as the real client identity.
//
//   This prevents a direct-access attacker from rotating CF-Connecting-IP headers
//   to create a fresh rate-limit bucket on every request. Even if an attacker
//   also forges X-Forwarded-For to appear as a Cloudflare edge node, req.ip is
//   still derived from that attacker-controlled header and must not be used as
//   the trust signal.
//
//   Production setup:
//     Set RATE_LIMIT_TRUSTED_PROXY_IPS to the Nginx host IP(s) (e.g. 127.0.0.1).
//     Ensure Nginx strips any client-injected CF-Connecting-IP headers and only
//     forwards what Cloudflare set, so the header is trustworthy when present.
//
//   Development / test (env var absent):
//     CF-Connecting-IP is always ignored; all requests key on the raw socket IP.
const contactLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: new DbRateLimitStore(),
  keyGenerator: (req) => {
    // Normalise the socket IP: strip the IPv6-mapped IPv4 prefix so that
    // "::ffff:127.0.0.1" and "127.0.0.1" both match the same config value.
    const socketIp = (req.socket?.remoteAddress ?? "").replace(/^::ffff:/i, "");

    const trustedProxies = (process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (trustedProxies.length > 0 && trustedProxies.includes(socketIp)) {
      // Socket came from a configured trusted proxy — CF-Connecting-IP is
      // trustworthy (Nginx stripped any client-injected version of this header).
      const cfHeader = req.headers["cf-connecting-ip"];
      if (typeof cfHeader === "string" && cfHeader.trim()) {
        return `contact:${ipKeyGenerator(cfHeader.trim())}`;
      }
    }

    // No trusted proxy match: key on the non-spoofable socket IP directly.
    // safeIpKey(req) reads req.ip which is derived from X-Forwarded-For and
    // is client-controllable. socketIp is taken from req.socket.remoteAddress
    // before any proxy trust processing and cannot be forged by the caller.
    return `contact:${ipKeyGenerator(socketIp || "unknown")}`;
  },
  message: { error: "Too many submissions. Please wait before trying again." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKET_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VALID_CATEGORIES = ["general", "payments", "account", "technical", "billing", "kyc", "other"];

function generateTicketRef(): string {
  let ref = "RK-";
  for (let i = 0; i < 8; i++) {
    ref += TICKET_CHARS[Math.floor(Math.random() * TICKET_CHARS.length)];
  }
  return ref;
}

// POST /public/contact — unauthenticated public contact form submission
router.post("/public/contact", contactLimiter, async (req, res) => {
  try {
    const { name, email, phone, subject, category, message } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Please enter your full name." });
    }
    if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!subject || typeof subject !== "string" || subject.trim().length < 3) {
      return res.status(400).json({ error: "Please enter a subject." });
    }
    if (!message || typeof message !== "string" || message.trim().length < 10) {
      return res.status(400).json({ error: "Message must be at least 10 characters." });
    }
    if (message.trim().length > 5000) {
      return res.status(400).json({ error: "Message is too long (max 5000 characters)." });
    }

    const resolvedCategory = VALID_CATEGORIES.includes(category) ? category : "general";
    const ticketRef = generateTicketRef();
    const ipAddress = (req.headers["cf-connecting-ip"] as string) || req.ip || null;
    const userAgent = (req.headers["user-agent"] as string) || null;

    await db.insert(contactSubmissionsTable).values({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
      subject: subject.trim(),
      category: resolvedCategory,
      message: message.trim(),
      ticketRef,
      ipAddress,
      userAgent,
      status: "open",
    });

    req.log.info({ ticketRef, email: email.trim() }, "contact_form_submitted");

    return res.json({
      success: true,
      ticketRef,
      message: "Your message has been received. We will respond within 2 business days.",
    });
  } catch (err) {
    req.log.error({ err }, "contact_form_submission_failed");
    return res.status(500).json({ error: "Failed to submit your message. Please try again." });
  }
});

// GET /admin/contact-submissions — admin view of contact form submissions
router.get("/admin/contact-submissions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt((req.query["limit"] as string) || "20", 10)));
    const offset = (page - 1) * limit;

    const rows = await db
      .select()
      .from(contactSubmissionsTable)
      .orderBy(desc(contactSubmissionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({ data: rows, page, limit });
  } catch (err) {
    req.log.error({ err }, "admin_contact_submissions_fetch_failed");
    return res.status(500).json({ error: "Failed to load contact submissions." });
  }
});

export default router;
