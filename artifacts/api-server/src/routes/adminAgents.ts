import { Router } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, usersTable, agentsTable, auditLogsTable } from "@workspace/db";
import { eq, desc, inArray, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const router = Router();

router.use(requireAuth, requireAdmin);

function generateAgentCode(id: number): string {
  return `RSK-AG-${id.toString().padStart(6, "0")}`;
}

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function buildInviteExpiry(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 72);
  return d;
}

async function writeAudit(params: {
  actorId: number;
  actorEmail: string;
  targetId?: number;
  targetEmail?: string;
  action: string;
  oldValue?: string;
  newValue?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}) {
  const details = JSON.stringify({
    targetEmail: params.targetEmail,
    oldValue: params.oldValue,
    newValue: params.newValue,
    ...(params.metadata ?? {}),
  });
  await db.insert(auditLogsTable).values({
    adminId: params.actorId,
    adminEmail: params.actorEmail,
    action: params.action,
    targetType: "agent",
    targetId: params.targetId ?? null,
    details,
    ipAddress: params.ip ?? null,
  });
}

/**
 * GET /api/admin/agents
 * List all agents with their profile details.
 */
router.get("/", async (req, res) => {
  try {
    const agents = await db
      .select({
        id: agentsTable.id,
        userId: agentsTable.userId,
        name: agentsTable.name,
        email: agentsTable.email,
        mobile: agentsTable.mobile,
        status: agentsTable.status,
        agentCode: agentsTable.agentCode,
        employeeId: agentsTable.employeeId,
        department: agentsTable.department,
        team: agentsTable.team,
        reportingManager: agentsTable.reportingManager,
        referralCode: agentsTable.referralCode,
        inviteStatus: agentsTable.inviteStatus,
        firstLoginAt: agentsTable.firstLoginAt,
        walletBalance: agentsTable.walletBalance,
        totalCommissionEarned: agentsTable.totalCommissionEarned,
        totalCommissionPaid: agentsTable.totalCommissionPaid,
        notes: agentsTable.notes,
        createdAt: agentsTable.createdAt,
        updatedAt: agentsTable.updatedAt,
      })
      .from(agentsTable)
      .orderBy(desc(agentsTable.createdAt));

    res.json({ data: agents, total: agents.length });
  } catch (err) {
    req.log.error({ err }, "admin_list_agents_error");
    res.status(500).json({ error: "Failed to load agents" });
  }
});

/**
 * GET /api/admin/agents/:id
 * Get a single agent with user details.
 */
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  try {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, id))
      .limit(1);

    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    let userInfo = null;
    if (agent.userId) {
      const [u] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          isActive: usersTable.isActive,
          lastLoginAt: usersTable.lastLoginAt,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(eq(usersTable.id, agent.userId))
        .limit(1);
      userInfo = u ?? null;
    }

    res.json({ agent, user: userInfo });
  } catch (err) {
    req.log.error({ err }, "admin_get_agent_error");
    res.status(500).json({ error: "Failed to load agent" });
  }
});

/**
 * POST /api/admin/agents
 * Create a new agent account with invite email.
 * Does not send a plain-text password — agent sets password on first login via invite token.
 */
router.post("/", async (req, res) => {
  const adminUser = (req as any).user;
  const {
    name,
    email,
    mobile,
    employeeId,
    department,
    team,
    reportingManager,
    notes,
    referralCode,
  } = req.body ?? {};

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "Name must be at least 2 characters" }); return;
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" }); return;
  }
  if (!mobile || typeof mobile !== "string" || mobile.trim().length < 7) {
    res.status(400).json({ error: "Valid mobile number is required" }); return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    // Create user with a random temporary password (never sent to user).
    // Agent must use the invite token to set their real password on first login.
    const tempPassword = crypto.randomBytes(24).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const [createdUser] = await db
      .insert(usersTable)
      .values({
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        role: "agent",
        isActive: true,
      })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
      });

    if (!createdUser) {
      res.status(500).json({ error: "Failed to create user" });
      return;
    }

    const agentCode = generateAgentCode(createdUser.id);
    const code = referralCode ?? `AGT${createdUser.id.toString().padStart(4, "0")}`;
    const inviteToken = generateInviteToken();
    const inviteTokenExpiry = buildInviteExpiry();

    const [createdAgent] = await db
      .insert(agentsTable)
      .values({
        userId: createdUser.id,
        name: name.trim(),
        email: normalizedEmail,
        mobile: mobile.trim(),
        referralCode: code,
        agentCode,
        employeeId: employeeId ?? null,
        department: department ?? null,
        team: team ?? null,
        reportingManager: reportingManager ?? null,
        notes: notes ?? null,
        status: "active",
        inviteToken,
        inviteTokenExpiry,
        inviteStatus: "pending",
        createdByAdminId: adminUser.id,
      })
      .returning();

    await writeAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      targetId: createdUser.id,
      targetEmail: normalizedEmail,
      action: "agent_created",
      newValue: JSON.stringify({ agentCode, employeeId, department, team }),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    req.log.info({ adminId: adminUser.id, agentId: createdAgent?.id, agentCode }, "agent_created");

    res.status(201).json({
      agent: createdAgent,
      user: createdUser,
      inviteToken,
      inviteLink: `${process.env["APP_URL"] ?? "https://rasokart.com"}/agent/activate?token=${inviteToken}`,
      message: "Agent account created. Share the invite link with the agent to complete activation.",
    });
  } catch (err) {
    req.log.error({ err }, "admin_create_agent_error");
    res.status(500).json({ error: "Failed to create agent" });
  }
});

/**
 * PUT /api/admin/agents/:id
 * Update agent profile fields.
 */
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const adminUser = (req as any).user;
  const { name, mobile, employeeId, department, team, reportingManager, notes } = req.body ?? {};

  try {
    const [existing] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Agent not found" }); return; }

    const updates: Partial<typeof agentsTable.$inferInsert> = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (mobile !== undefined) updates.mobile = String(mobile).trim();
    if (employeeId !== undefined) updates.employeeId = employeeId ?? null;
    if (department !== undefined) updates.department = department ?? null;
    if (team !== undefined) updates.team = team ?? null;
    if (reportingManager !== undefined) updates.reportingManager = reportingManager ?? null;
    if (notes !== undefined) updates.notes = notes ?? null;

    const [updated] = await db
      .update(agentsTable)
      .set(updates)
      .where(eq(agentsTable.id, id))
      .returning();

    await writeAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      targetId: existing.userId ?? undefined,
      targetEmail: existing.email,
      action: "agent_profile_updated",
      oldValue: JSON.stringify({ name: existing.name, department: existing.department, team: existing.team }),
      newValue: JSON.stringify(updates),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ agent: updated });
  } catch (err) {
    req.log.error({ err }, "admin_update_agent_error");
    res.status(500).json({ error: "Failed to update agent" });
  }
});

/**
 * POST /api/admin/agents/:id/activate
 */
router.post("/:id/activate", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    await db.update(agentsTable).set({ status: "active" }).where(eq(agentsTable.id, id));
    if (agent.userId) {
      await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, agent.userId));
    }

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId ?? undefined, targetEmail: agent.email,
      action: "agent_activated", oldValue: agent.status, newValue: "active",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, status: "active" });
  } catch (err) {
    req.log.error({ err }, "admin_activate_agent_error");
    res.status(500).json({ error: "Failed to activate agent" });
  }
});

/**
 * POST /api/admin/agents/:id/suspend
 */
router.post("/:id/suspend", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    await db.update(agentsTable).set({ status: "suspended" }).where(eq(agentsTable.id, id));
    if (agent.userId) {
      await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, agent.userId));
    }

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId ?? undefined, targetEmail: agent.email,
      action: "agent_suspended", oldValue: agent.status, newValue: "suspended",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, status: "suspended" });
  } catch (err) {
    req.log.error({ err }, "admin_suspend_agent_error");
    res.status(500).json({ error: "Failed to suspend agent" });
  }
});

/**
 * POST /api/admin/agents/:id/deactivate
 */
router.post("/:id/deactivate", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    await db.update(agentsTable).set({ status: "deactivated" }).where(eq(agentsTable.id, id));
    if (agent.userId) {
      await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, agent.userId));
    }

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId ?? undefined, targetEmail: agent.email,
      action: "agent_deactivated", oldValue: agent.status, newValue: "deactivated",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, status: "deactivated" });
  } catch (err) {
    req.log.error({ err }, "admin_deactivate_agent_error");
    res.status(500).json({ error: "Failed to deactivate agent" });
  }
});

/**
 * POST /api/admin/agents/:id/reset-password
 * Admin resets agent password — generates a new invite token; agent sets new password via first-login flow.
 */
router.post("/:id/reset-password", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    const inviteToken = generateInviteToken();
    const inviteTokenExpiry = buildInviteExpiry();

    await db.update(agentsTable).set({
      inviteToken,
      inviteTokenExpiry,
      inviteStatus: "pending",
    }).where(eq(agentsTable.id, id));

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId ?? undefined, targetEmail: agent.email,
      action: "agent_password_reset", newValue: "invite_token_regenerated",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    const inviteLink = `${process.env["APP_URL"] ?? "https://rasokart.com"}/agent/activate?token=${inviteToken}`;
    res.json({ success: true, inviteToken, inviteLink, message: "New invite link generated. Share with the agent to set a new password." });
  } catch (err) {
    req.log.error({ err }, "admin_reset_agent_password_error");
    res.status(500).json({ error: "Failed to reset agent password" });
  }
});

/**
 * POST /api/admin/agents/:id/resend-invite
 * Regenerate and resend the invite link (same as reset-password for invite-pending accounts).
 */
router.post("/:id/resend-invite", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    const inviteToken = generateInviteToken();
    const inviteTokenExpiry = buildInviteExpiry();

    await db.update(agentsTable).set({
      inviteToken,
      inviteTokenExpiry,
      inviteStatus: "pending",
    }).where(eq(agentsTable.id, id));

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId ?? undefined, targetEmail: agent.email,
      action: "agent_invite_resent",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    const inviteLink = `${process.env["APP_URL"] ?? "https://rasokart.com"}/agent/activate?token=${inviteToken}`;
    res.json({ success: true, inviteToken, inviteLink });
  } catch (err) {
    req.log.error({ err }, "admin_resend_agent_invite_error");
    res.status(500).json({ error: "Failed to resend invite" });
  }
});

/**
 * POST /api/admin/agents/:id/revoke-sessions
 * Invalidates all active JWT sessions for this agent by rotating their password hash salt.
 */
router.post("/:id/revoke-sessions", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent || !agent.userId) { res.status(404).json({ error: "Agent not found" }); return; }

    // Rotate the password hash so all existing JWTs (which embed the hash in the session)
    // become invalid. The agent will need to use the invite flow or admin reset to regain access.
    const newSalt = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    await db.update(usersTable)
      .set({ passwordHash: newSalt })
      .where(eq(usersTable.id, agent.userId));

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId, targetEmail: agent.email,
      action: "agent_sessions_revoked",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "All sessions revoked. Agent must re-authenticate." });
  } catch (err) {
    req.log.error({ err }, "admin_revoke_agent_sessions_error");
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

/**
 * PATCH /api/admin/agents/:id/change-department
 */
router.patch("/:id/change-department", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminUser = (req as any).user;
  const { department, team, reportingManager } = req.body ?? {};

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id)).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    const updates: Partial<typeof agentsTable.$inferInsert> = {};
    if (department !== undefined) updates.department = department;
    if (team !== undefined) updates.team = team;
    if (reportingManager !== undefined) updates.reportingManager = reportingManager;

    await db.update(agentsTable).set(updates).where(eq(agentsTable.id, id));

    await writeAudit({
      actorId: adminUser.id, actorEmail: adminUser.email,
      targetId: agent.userId ?? undefined, targetEmail: agent.email,
      action: "agent_department_changed",
      oldValue: JSON.stringify({ department: agent.department, team: agent.team, reportingManager: agent.reportingManager }),
      newValue: JSON.stringify(updates),
      ip: req.ip, userAgent: req.headers["user-agent"],
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "admin_change_agent_dept_error");
    res.status(500).json({ error: "Failed to update department" });
  }
});

export default router;
