import { Router } from "express";
import { db, agentsTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router = Router();

/**
 * GET /api/agent/activate/verify
 * Verify that an invite token is valid and not expired.
 * Public endpoint — no auth required.
 */
router.get("/verify", async (req, res) => {
  const token = req.query["token"] as string | undefined;
  if (!token || typeof token !== "string" || token.length < 32) {
    res.status(400).json({ error: "Invalid or missing token" });
    return;
  }

  try {
    const [agent] = await db
      .select({
        id: agentsTable.id,
        email: agentsTable.email,
        name: agentsTable.name,
        agentCode: agentsTable.agentCode,
        inviteStatus: agentsTable.inviteStatus,
        inviteTokenExpiry: agentsTable.inviteTokenExpiry,
      })
      .from(agentsTable)
      .where(eq(agentsTable.inviteToken, token))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: "Invalid invite link. It may have already been used or never existed." });
      return;
    }

    if (agent.inviteStatus === "accepted") {
      res.status(409).json({ error: "This invite has already been used. Please log in or request a new invite from your admin." });
      return;
    }

    if (agent.inviteTokenExpiry && new Date() > new Date(agent.inviteTokenExpiry)) {
      res.status(410).json({ error: "This invite link has expired. Please ask your admin to resend the invite." });
      return;
    }

    res.json({
      valid: true,
      email: agent.email,
      name: agent.name,
      agentCode: agent.agentCode,
    });
  } catch (err) {
    req.log.error({ err }, "agent_activate_verify_error");
    res.status(500).json({ error: "Failed to verify invite token" });
  }
});

/**
 * POST /api/agent/activate/set-password
 * Complete agent activation: set password and mark invite as accepted.
 * Public endpoint — no auth required.
 */
router.post("/set-password", async (req, res) => {
  const { token, password } = req.body ?? {};

  if (!token || typeof token !== "string" || token.length < 32) {
    res.status(400).json({ error: "Invalid or missing token" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  // Basic password complexity check
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasUpper || !hasLower || !hasDigit) {
    res.status(400).json({ error: "Password must contain uppercase, lowercase, and a number" });
    return;
  }

  try {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.inviteToken, token))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: "Invalid invite link" });
      return;
    }
    if (agent.inviteStatus === "accepted") {
      res.status(409).json({ error: "This invite has already been used" });
      return;
    }
    if (agent.inviteTokenExpiry && new Date() > new Date(agent.inviteTokenExpiry)) {
      res.status(410).json({ error: "Invite link has expired. Ask your admin for a new one." });
      return;
    }
    if (!agent.userId) {
      res.status(500).json({ error: "Agent account is incomplete. Contact support." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();

    await db.update(usersTable)
      .set({ passwordHash, isActive: true })
      .where(eq(usersTable.id, agent.userId));

    await db.update(agentsTable)
      .set({
        inviteStatus: "accepted",
        inviteToken: null,
        inviteTokenExpiry: null,
        firstLoginAt: now,
        passwordSetAt: now,
      })
      .where(eq(agentsTable.id, agent.id));

    await db.insert(auditLogsTable).values({
      adminId: agent.userId,
      adminEmail: agent.email,
      action: "agent_activation_completed",
      targetType: "agent",
      targetId: agent.userId,
      details: JSON.stringify({ agentCode: agent.agentCode, newValue: "password_set" }),
      ipAddress: req.ip ?? null,
    });

    req.log.info({ agentId: agent.id, agentCode: agent.agentCode }, "agent_activation_completed");

    res.json({ success: true, message: "Account activated. You can now log in." });
  } catch (err) {
    req.log.error({ err }, "agent_activate_set_password_error");
    res.status(500).json({ error: "Failed to activate account" });
  }
});

export default router;
