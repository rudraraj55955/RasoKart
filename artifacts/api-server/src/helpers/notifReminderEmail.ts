const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

export function buildNotifReminderHtml(opts: { name: string }): string {
  const { name } = opts;
  const prefsLink = `${APP_DOMAIN}/merchant/security?section=notifications`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #78350f; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Notifications Disabled</h1>
      <p style="margin: 4px 0 0; color: #fde68a; font-size: 13px;">You've had email notifications turned off for over 30 days</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Hi <strong>${name}</strong>,
      </p>
      <p style="margin: 0 0 16px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        We noticed that one or more of your RasoKart email notification categories have been disabled for more than 30 days.
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        While your account is fully operational, you may be missing important alerts such as:
      </p>

      <div style="background: #111; border: 1px solid #2a2a2a; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
        <ul style="margin: 0; padding-left: 18px; color: #a1a1aa; font-size: 13px; line-height: 2;">
          <li>Settlement status updates</li>
          <li>Plan changes and renewals</li>
          <li>Reconciliation results</li>
          <li>API key activity</li>
          <li>Webhook failure alerts</li>
          <li>Login alerts</li>
        </ul>
      </div>

      <p style="margin: 0 0 24px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        To re-enable your notifications and stay informed about your account activity, visit your notification preferences:
      </p>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${prefsLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Manage Notification Preferences
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${prefsLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This reminder was sent because your notification preferences have been partially disabled for over 30 days.
        If you intentionally turned them off, no action is needed — you won't receive another reminder for 30 days.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}
