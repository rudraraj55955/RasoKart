import crypto from "node:crypto";
import os from "node:os";
import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const SUPPORTED_COMMANDS = new Set([
  "health-check",
  "health",
  "ping",
  "status",
]);

const CALLBACK_RETRY_DELAYS_MS = [600, 2_000, 5_000] as const;
const OUTBOUND_TIMEOUT_MS = 10_000;

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyHmac(
  raw: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  return timingSafeEqualStr(signatureHeader.trim(), expected);
}

export function isAllowedControlUrl(
  rawUrl: string,
  nodeEnv: string | undefined = process.env["NODE_ENV"],
): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      nodeEnv !== "production" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isAllowedCallbackUrl(
  rawUrl: string,
  controlUrl: string | undefined = process.env["RUDRARAJ_CONTROL_URL"],
  nodeEnv: string | undefined = process.env["NODE_ENV"],
): boolean {
  const trimmedControl = controlUrl?.trim();
  if (!trimmedControl || !isAllowedControlUrl(trimmedControl, nodeEnv)) {
    return false;
  }
  if (!isAllowedControlUrl(rawUrl, nodeEnv)) {
    return false;
  }
  try {
    const parsedCallback = new URL(rawUrl);
    const parsedControl = new URL(trimmedControl);
    return parsedCallback.origin === parsedControl.origin;
  } catch {
    return false;
  }
}

async function consumeResponseBody(response: globalThis.Response): Promise<void> {
  try {
    if (response.body) {
      await response.body.cancel();
    }
  } catch {
    // Ignore body cancellation errors on already-closed streams.
  }
}

function buildCommandReport(command: string): string {
  const memUsedMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const uptimeSec = Math.round(process.uptime());
  return `RasoKart API executed "${command}" cleanly (uptime ${uptimeSec}s, RSS ${memUsedMb}MB, host ${os.hostname()}).`;
}

function scheduleCompletionCallback(params: {
  callbackUrl: string;
  apiKey: string;
  taskId: string;
  projectId: string;
  command: string;
}): void {
  const attemptDelivery = (attemptIndex: number): void => {
    const delayMs = CALLBACK_RETRY_DELAYS_MS[attemptIndex] ?? CALLBACK_RETRY_DELAYS_MS[CALLBACK_RETRY_DELAYS_MS.length - 1];
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(params.callbackUrl, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/json",
            "x-api-key": params.apiKey,
          },
          body: JSON.stringify({
            taskId: params.taskId,
            projectId: params.projectId,
            status: "COMPLETED",
            message: buildCommandReport(params.command),
          }),
        });
        await consumeResponseBody(response);
        if (response.ok) return;

        logger.warn(
          {
            taskId: params.taskId,
            attempt: attemptIndex + 1,
            status: response.status,
          },
          "rudraraj_command_callback_non_2xx",
        );
      } catch (err) {
        logger.warn(
          {
            err,
            taskId: params.taskId,
            attempt: attemptIndex + 1,
          },
          "rudraraj_command_callback_error",
        );
      }

      if (attemptIndex + 1 < CALLBACK_RETRY_DELAYS_MS.length) {
        attemptDelivery(attemptIndex + 1);
      }
    }, delayMs);
    timer.unref?.();
  };

  attemptDelivery(0);
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
  if (!rawBody || rawBody.length === 0 || !sigStr || !verifyHmac(rawBody, sigStr, expectedKey)) {
    res.status(401).json({
      error: "Unauthorized: valid HMAC-SHA256 x-rudraraj-signature and raw JSON body are required.",
    });
    return;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Invalid request payload: expected a JSON object." });
    return;
  }

  const payload = req.body as Record<string, unknown>;

  if (payload["taskId"] !== undefined && typeof payload["taskId"] !== "string") {
    res.status(400).json({ error: "Invalid taskId: must be a string." });
    return;
  }
  if (payload["projectId"] !== undefined && typeof payload["projectId"] !== "string") {
    res.status(400).json({ error: "Invalid projectId: must be a string." });
    return;
  }
  if (payload["command"] !== undefined && typeof payload["command"] !== "string") {
    res.status(400).json({ error: "Invalid command: must be a string." });
    return;
  }
  if (payload["callbackUrl"] !== undefined && typeof payload["callbackUrl"] !== "string") {
    res.status(400).json({ error: "Invalid callbackUrl: must be a string." });
    return;
  }

  const rawCommand = (payload["command"] as string | undefined)?.trim();
  const command = rawCommand && rawCommand.length > 0 ? rawCommand.toLowerCase() : "health-check";
  if (!SUPPORTED_COMMANDS.has(command)) {
    res.status(400).json({
      error: `Unsupported command "${command.slice(0, 80)}".`,
      supportedCommands: Array.from(SUPPORTED_COMMANDS),
    });
    return;
  }

  const callbackUrl = (payload["callbackUrl"] as string | undefined)?.trim();
  if (callbackUrl && !isAllowedCallbackUrl(callbackUrl)) {
    res.status(400).json({
      error: "Invalid callbackUrl: must match the configured HTTPS Rudraraj control origin.",
    });
    return;
  }

  const rawTaskId = (payload["taskId"] as string | undefined)?.trim();
  const taskId = rawTaskId && rawTaskId.length > 0 ? rawTaskId : `rasokart-${crypto.randomUUID()}`;
  const rawProjectId = (payload["projectId"] as string | undefined)?.trim();
  const projectId =
    rawProjectId && rawProjectId.length > 0
      ? rawProjectId
      : process.env["RUDRARAJ_PROJECT_ID"]?.trim() || "proj-rasokart";

  if (callbackUrl) {
    scheduleCompletionCallback({
      callbackUrl,
      apiKey: expectedKey,
      taskId,
      projectId,
      command,
    });
  }

  res.status(202).json({
    ok: true,
    status: "RUNNING",
    service: "rasokart-api",
    taskId,
    command,
    verifiedSignature: true,
    message: "RasoKart API accepted signed Rudraraj command (RUNNING).",
  });
});

export function startRudrarajHeartbeat(): ReturnType<typeof setInterval> | null {
  const controlUrl = process.env["RUDRARAJ_CONTROL_URL"]
    ?.trim()
    .replace(/\/+$/, "");
  const apiKey = process.env["RUDRARAJ_API_KEY"]?.trim();
  if (!controlUrl || !apiKey) return null;

  if (!isAllowedControlUrl(controlUrl)) {
    logger.warn(
      { controlUrlProtocol: (() => { try { return new URL(controlUrl).protocol; } catch { return "invalid"; } })() },
      "rudraraj_heartbeat_disabled_insecure_control_url",
    );
    return null;
  }

  const projectId =
    process.env["RUDRARAJ_PROJECT_ID"]?.trim() || "proj-rasokart";
  let lastMeasuredLatencyMs: number | null = null;

  const sendPulse = async () => {
    const totalMem = os.totalmem();
    const usedMem = Math.max(0, totalMem - os.freemem());
    const cpuCores = Math.max(1, os.cpus().length);
    const cpuUsage = Math.min(
      100,
      Math.max(1, Math.round(((os.loadavg()[0] || 0) / cpuCores) * 100)),
    );
    const memoryUsage = Math.min(100, Math.round((usedMem / totalMem) * 100));
    const fetchStarted = Date.now();

    try {
      const response = await fetch(`${controlUrl}/api/control/heartbeat`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          projectId,
          status: "ONLINE",
          latencyMs: lastMeasuredLatencyMs,
          cpuUsage,
          memoryUsage,
          note: `RasoKart API heartbeat (${os.hostname()} · uptime ${Math.round(process.uptime())}s)`,
        }),
      });
      await consumeResponseBody(response);
      lastMeasuredLatencyMs = Math.max(1, Date.now() - fetchStarted);
      if (!response.ok) {
        logger.warn({ status: response.status }, "rudraraj_heartbeat_non_2xx");
      }
    } catch (err) {
      logger.warn({ err }, "rudraraj_heartbeat_failed");
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
