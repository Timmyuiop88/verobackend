/**
 * Minimal, dependency-free HTML wrapper — no MJML/React-email needed for the
 * handful of transactional emails TradeVero sends. Swap this out for a
 * proper template engine later if the design needs grow.
 */
export function renderEmailLayout(params: {
  heading: string;
  bodyHtml: string;
}): string {
  const { heading, bodyHtml } = params;
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111827;padding:20px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;">TradeVero</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${heading}</h1>
                <div style="font-size:14px;line-height:1.6;color:#374151;">${bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
                <span style="font-size:12px;color:#9ca3af;">You're receiving this because of activity on your TradeVero wallet/account.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function amountRow(label: string, valueUsd: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f9fafb;border-radius:8px;">
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#6b7280;">${label}</td>
      <td style="padding:12px 16px;font-size:16px;font-weight:700;color:#111827;text-align:right;">${valueUsd}</td>
    </tr>
  </table>`;
}
