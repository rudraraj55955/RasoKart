import { Router } from "express";
import { db, contactSubmissionsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { desc } from "drizzle-orm";

const router = Router();

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
router.post("/public/contact", async (req, res) => {
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
