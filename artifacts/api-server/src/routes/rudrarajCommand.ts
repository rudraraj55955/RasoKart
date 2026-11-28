import crypto from "node:crypto";
import os from "node:os";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyHmac(
  raw: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  return timingSafeEqualStr(signatureHeader.trim(), expected);
}

function isAllowedCallbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      process.env["NODE_ENV"] !== "production" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

router.post("/", (req: Request, res: Response) => {
  const expectedKey = process.env["RUDRARAJ_API_KEY"]?.trim();
  if (!expectedKey) {
    res.status(503).json({
      error:
        "Rudraraj command receiver is disabled (RUDRARAJ_API_KEY not configured).",
    });
    return;
  }

  const providedKey = String(req.headers["x-api-key"] ?? "").trim();
  if (!providedKey || !timingSafeEqualStr(providedKey, expectedKey)) {
    res.status(401).json({ error: "Unauthorized: invalid x-api-key." });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const sigHeader = req.headers["x-rudraraj-signature"];
  const sigStr = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (sigStr && rawBody && !verifyHmac(rawBody, sigStr, expectedKey)) {
    res.status(401).json({
      error: "Unauthorized: HMAC-SHA256 x-rudraraj-signature mismatch.",
    });
    return;
  }

  const payload = (req.body ?? {}) as {
    taskId?: string;
    projectId?: string;
    command?: string;
    callbackUrl?: string;
  };

  const taskId = payload.taskId || `rasokart-${Date.now()}`;
  const command = payload.command || "health-check";
  const callbackUrl = payload.callbackUrl;

  if (callbackUrl && isAllowedCallbackUrl(callbackUrl)) {
    setTimeout(async () => {
      const memUsedMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
      const uptimeSec = Math.round(process.uptime());
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": expectedKey,
          },
          body: JSON.stringify({
            taskId,
            projectId:
              payload.projectId ||
              process.env["RUDRARAJ_PROJECT_ID"] ||
              "proj-rasokart",
            status: "COMPLETED",
            message: `RasoKart API verified "${command.slice(0, 80)}" cleanly (uptime ${uptimeSec}s, RSS ${memUsedMb}MB, host ${os.hostname()}).`,
          }),
        });
      } catch {
        // Non-fatal
      }
    }, 600);
  }

  res.status(202).json({
    ok: true,
    status: "RUNNING",
    service: "rasokart-api",
    taskId,
    verifiedSignature: Boolean(sigStr),
    message: "RasoKart API accepted signed Rudraraj command (RUNNING).",
  });
});

export function startRudrarajHeartbeat(): ReturnType<typeof setInterval> | null {
  const controlUrl = process.env["RUDRARAJ_CONTROL_URL"]
    ?.trim()
    .replace(/\/+$/, "");
  const apiKey = process.env["RUDRARAJ_API_KEY"]?.trim();
  if (!controlUrl || !apiKey) return null;

  const projectId =
    process.env["RUDRARAJ_PROJECT_ID"]?.trim() || "proj-rasokart";

  const sendPulse = async () => {
    const started = Date.now();
    const totalMem = os.totalmem();
    const usedMem = Math.max(0, totalMem - os.freemem());
    const cpuCores = Math.max(1, os.cpus().length);
    const cpuUsage = Math.min(
      100,
      Math.max(1, Math.round(((os.loadavg()[0] || 0) / cpuCores) * 100)),
    );
    const memoryUsage = Math.min(100, Math.round((usedMem / totalMem) * 100));

    try {
      await fetch(`${controlUrl}/api/control/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          projectId,
          status: "ONLINE",
          latencyMs: Math.max(1, Date.now() - started),
          cpuUsage,
          memoryUsage,
          note: `RasoKart API heartbeat (${os.hostname()} · uptime ${Math.round(process.uptime())}s)`,
        }),
      });
    } catch {
      // Non-fatal
    }
  };

  void sendPulse();
  const interval = setInterval(() => {
    void sendPulse();
  }, 60_000);
  interval.unref?.();
  return interval;
}

export default router;
