/**
 * Email Notification Service
 * Sends transactional emails via Microsoft Graph API (OAuth2 client credentials flow)
 * using Azure AD app registration, or falls back to storing email records for external pickup.
 */

import type { Env } from '../types';
import { logError } from './logger';

export interface EmailPayload {
  to: string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  from?: string;
  replyTo?: string;
  tenantId: string;
}

export interface EmailResult {
  id: string;
  sent: boolean;
  channel: 'msgraph' | 'queued';
  error?: string;
}

// ── Atheon Brand Constants ──

const BRAND = {
  outerBg: '#0a0a14',
  cardBg: '#16161e',
  cardBorder: 'rgba(245,197,66,0.12)',
  text: '#f0f0f2',
  muted: '#9a9ab0',
  accent: '#f5c542',
  accentDark: '#d4941a',
  credBg: '#111118',
  codeBg: '#1e1e2a',
  footerBorder: 'rgba(255,255,255,0.06)',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  blue: '#3B82F6',
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
} as const;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 72 72"><defs><linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${BRAND.accent}"/><stop offset="100%" style="stop-color:${BRAND.accentDark}"/></linearGradient><linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:rgba(255,255,255,0.25)"/><stop offset="100%" style="stop-color:rgba(255,255,255,0)"/></linearGradient></defs><rect width="72" height="72" rx="20" fill="url(#lg1)"/><rect x="2" y="2" width="68" height="36" rx="18" fill="url(#lg2)"/><text x="36" y="50" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="40" font-weight="800" fill="#16161e">A</text></svg>`;

// ── Shared Helpers ──

function wrapEmail(cardContent: string, accentBorderColor?: string): string {
  const borderStyle = accentBorderColor
    ? `border-left:4px solid ${accentBorderColor};`
    : `border:1px solid ${BRAND.cardBorder};`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Atheon</title></head>
<body style="margin:0;padding:0;background:${BRAND.outerBg};font-family:${BRAND.font};-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.outerBg};padding:40px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td align="center" style="padding:0 0 8px">${LOGO_SVG}</td></tr>
  <tr><td align="center" style="padding:0 0 4px"><h1 style="color:${BRAND.text};font-size:22px;font-weight:700;margin:0;letter-spacing:-0.3px">Atheon</h1></td></tr>
  <tr><td align="center" style="padding:0 0 28px"><p style="color:${BRAND.accent};font-size:11px;margin:0;font-weight:500;letter-spacing:1.5px;text-transform:uppercase">Enterprise Intelligence Platform</p></td></tr>
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cardBg};border-radius:16px;${borderStyle}">
      <tr><td style="padding:32px">${cardContent}</td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:28px 0 8px">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding:0 12px"><a href="https://atheon.vantax.co.za" style="color:${BRAND.muted};font-size:12px;text-decoration:none">Dashboard</a></td>
      <td style="color:rgba(255,255,255,0.15);font-size:12px">|</td>
      <td style="padding:0 12px"><a href="https://atheon.vantax.co.za" style="color:${BRAND.muted};font-size:12px;text-decoration:none">Support</a></td>
      <td style="color:rgba(255,255,255,0.15);font-size:12px">|</td>
      <td style="padding:0 12px"><a href="https://atheon.vantax.co.za" style="color:${BRAND.muted};font-size:12px;text-decoration:none">Documentation</a></td>
    </tr></table>
  </td></tr>
  <tr><td align="center"><p style="color:rgba(154,154,176,0.6);font-size:11px;margin:0">Atheon\u2122 Enterprise Intelligence Platform</p><p style="color:rgba(154,154,176,0.4);font-size:10px;margin:4px 0 0">This is an automated message. Please do not reply directly to this email.</p></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function ctaButton(href: string, label: string, color?: string): string {
  const bg = color || `linear-gradient(135deg,${BRAND.accent},${BRAND.accentDark})`;
  const textColor = color ? '#fff' : '#16161e';
  const shadow = color ? '' : `box-shadow:0 4px 16px rgba(245,197,66,0.25);`;
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${textColor};padding:12px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.3px;${shadow}">${label}</a>`;
}

function badge(label: string, bgColor: string, textColor = '#fff'): string {
  return `<span style="display:inline-block;background:${bgColor};color:${textColor};padding:4px 14px;border-radius:9999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">${label}</span>`;
}

function statBox(label: string, value: string | number, valueColor: string = BRAND.text): string {
  return `<div style="background:${BRAND.credBg};border-radius:10px;padding:14px 16px;flex:1;text-align:center;border:1px solid rgba(245,197,66,0.06)"><p style="color:${BRAND.muted};font-size:11px;margin:0;text-transform:uppercase;letter-spacing:0.5px">${label}</p><p style="color:${valueColor};font-size:22px;font-weight:700;margin:6px 0 0">${value}</p></div>`;
}

// ── Email Templates ──

export function getAlertEmailTemplate(title: string, message: string, severity: string, actionUrl?: string): { html: string; text: string } {
  const severityColor: Record<string, string> = {
    critical: BRAND.red, high: '#EA580C', medium: BRAND.amber, low: BRAND.blue, info: BRAND.muted,
  };
  const color = severityColor[severity] || BRAND.muted;

  const card = `
    ${badge(severity, color)}
    <h2 style="color:${BRAND.text};font-size:20px;margin:16px 0 12px;font-weight:600">${title}</h2>
    <p style="color:${BRAND.muted};font-size:14px;line-height:1.7;margin:0 0 24px">${message}</p>
    ${actionUrl ? `<div style="text-align:center">${ctaButton(actionUrl, 'View Details', color)}</div>` : ''}`;

  const html = wrapEmail(card, color);
  const text = `[${severity.toUpperCase()}] ${title}\n\n${message}${actionUrl ? `\n\nView details: ${actionUrl}` : ''}\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

export function getApprovalEmailTemplate(catalystName: string, action: string, confidence: number, reasoning: string, approvalUrl: string): { html: string; text: string } {
  const card = `
    ${badge('Approval Required', BRAND.amber, '#000')}
    <h2 style="color:${BRAND.text};font-size:20px;margin:16px 0 12px;font-weight:600">${catalystName}: ${action}</h2>
    <div style="background:${BRAND.credBg};border-radius:10px;padding:18px;margin:16px 0;border:1px solid rgba(245,197,66,0.06)">
      <p style="color:${BRAND.muted};font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px">Confidence Score</p>
      <p style="color:${BRAND.accent};font-size:28px;font-weight:700;margin:0">${(confidence * 100).toFixed(0)}%</p>
    </div>
    <p style="color:${BRAND.muted};font-size:14px;line-height:1.7;margin:0 0 24px">${reasoning}</p>
    <div style="text-align:center">
      ${ctaButton(`${approvalUrl}?action=approve`, 'Approve', BRAND.green)}
      <span style="display:inline-block;width:12px"></span>
      ${ctaButton(`${approvalUrl}?action=reject`, 'Reject', BRAND.red)}
    </div>`;

  const html = wrapEmail(card, BRAND.amber);
  const text = `[APPROVAL REQUIRED] ${catalystName}: ${action}\n\nConfidence: ${(confidence * 100).toFixed(0)}%\n\n${reasoning}\n\nApprove: ${approvalUrl}?action=approve\nReject: ${approvalUrl}?action=reject\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

export function getEscalationEmailTemplate(catalystName: string, action: string, escalationLevel: string, reason: string, actionUrl: string): { html: string; text: string } {
  const card = `
    ${badge(`Escalation: ${escalationLevel}`, BRAND.red)}
    <h2 style="color:${BRAND.text};font-size:20px;margin:16px 0 12px;font-weight:600">${catalystName}: ${action}</h2>
    <p style="color:${BRAND.muted};font-size:14px;line-height:1.7;margin:0 0 24px">${reason}</p>
    <div style="text-align:center">${ctaButton(actionUrl, 'Review Action', BRAND.blue)}</div>`;

  const html = wrapEmail(card, BRAND.red);
  const text = `[ESCALATION: ${escalationLevel.toUpperCase()}] ${catalystName}: ${action}\n\n${reason}\n\nReview: ${actionUrl}\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Welcome Email Template ──

export function getWelcomeEmailTemplate(
  name: string,
  email: string,
  temporaryPassword: string,
  loginUrl: string,
  _theme: 'dark' | 'light' = 'dark'
): { html: string; text: string } {
  void _theme;

  const card = `
    <p style="color:${BRAND.text};font-size:18px;margin:0 0 8px;font-weight:600">Hi ${name},</p>
    <p style="color:${BRAND.muted};font-size:14px;line-height:1.7;margin:0 0 28px">
      Your Atheon account has been created. Use the credentials below to sign in for the first time. You will be prompted to change your password after your initial login.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.credBg};border-radius:12px;border:1px solid rgba(245,197,66,0.08);margin:0 0 28px">
      <tr><td style="padding:24px">
        <p style="color:${BRAND.accent};font-size:11px;font-weight:600;margin:0 0 14px;text-transform:uppercase;letter-spacing:1.2px">Your Login Credentials</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:${BRAND.muted};font-size:13px;padding:6px 0;width:140px;vertical-align:top">Email</td>
            <td style="color:${BRAND.text};font-size:14px;padding:6px 0;font-weight:500">${email}</td>
          </tr>
          <tr>
            <td style="color:${BRAND.muted};font-size:13px;padding:6px 0;width:140px;vertical-align:top">Temporary Password</td>
            <td style="padding:6px 0">
              <code style="display:inline-block;background:${BRAND.codeBg};padding:4px 12px;border-radius:6px;color:${BRAND.accent};font-size:15px;font-weight:700;font-family:'SF Mono',Monaco,Consolas,'Courier New',monospace;letter-spacing:0.5px">${temporaryPassword}</code>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
    <div style="text-align:center;padding:0 0 28px">${ctaButton(loginUrl, 'Sign In to Atheon')}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BRAND.footerBorder}">
      <tr><td style="padding:20px 0 0">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;padding-right:10px">
            <div style="width:24px;height:24px;background:rgba(245,197,66,0.1);border-radius:6px;text-align:center;line-height:24px;font-size:13px">&#128274;</div>
          </td>
          <td>
            <p style="color:${BRAND.muted};font-size:12px;line-height:1.6;margin:0">
              <strong style="color:${BRAND.text}">Security Tip:</strong> Please change your password immediately after your first login. Never share your credentials with anyone.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>`;

  const html = wrapEmail(card);
  const text = `Welcome to Atheon!\n\nHi ${name},\n\nYour account has been created.\n\nEmail: ${email}\nTemporary Password: ${temporaryPassword}\n\nSign in at: ${loginUrl}\n\nPlease change your password after your first login.\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Password Reset Template ──

export function getPasswordResetEmailTemplate(
  name: string,
  resetUrl: string,
  _theme: 'dark' | 'light' = 'dark'
): { html: string; text: string } {
  void _theme;

  const card = `
    <h2 style="color:${BRAND.text};font-size:20px;margin:0 0 16px;font-weight:600">Reset Your Password</h2>
    <p style="color:${BRAND.muted};font-size:14px;line-height:1.7;margin:0 0 24px">Hi ${name}, we received a request to reset your password. Click the button below to set a new password:</p>
    <div style="text-align:center;margin:0 0 24px">${ctaButton(resetUrl, 'Reset Password')}</div>
    <p style="color:${BRAND.muted};font-size:12px;line-height:1.5;margin:0">This link expires in 1 hour. If you didn\u2019t request this, you can safely ignore this email.</p>`;

  const html = wrapEmail(card);
  const text = `Reset Your Password\n\nHi ${name}, click the link below to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Catalyst Run Results Email Template ──

export function getRunResultsEmailTemplate(
  catalystName: string,
  runSummary: { total: number; completed: number; exceptions: number; escalated: number; pending: number },
  topResults: Array<{ action: string; status: string; confidence: number }>,
  dashboardUrl: string,
): { html: string; text: string } {
  const statusColor = (s: string) => s === 'completed' || s === 'approved' ? BRAND.green : s === 'escalated' || s === 'pending_approval' ? BRAND.amber : s === 'failed' || s === 'exception' || s === 'rejected' ? BRAND.red : BRAND.muted;

  const resultRows = topResults.map(r =>
    `<tr><td style="color:${BRAND.muted};font-size:13px;padding:8px;border-bottom:1px solid ${BRAND.footerBorder}">${r.action}</td><td style="padding:8px;border-bottom:1px solid ${BRAND.footerBorder}">${badge(r.status, statusColor(r.status))}</td><td style="color:${BRAND.text};font-size:13px;padding:8px;border-bottom:1px solid ${BRAND.footerBorder};text-align:right;font-weight:600">${(r.confidence * 100).toFixed(0)}%</td></tr>`
  ).join('');

  const card = `
    ${badge('Run Report', BRAND.blue)}
    <h2 style="color:${BRAND.text};font-size:20px;margin:16px 0 12px;font-weight:600">${catalystName} \u2014 Execution Summary</h2>
    <div style="display:flex;gap:12px;margin:16px 0">
      ${statBox('Total', runSummary.total)}
      ${statBox('Completed', runSummary.completed, BRAND.green)}
      ${statBox('Exceptions', runSummary.exceptions, BRAND.red)}
      ${statBox('Pending', runSummary.pending + runSummary.escalated, BRAND.amber)}
    </div>
    ${topResults.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">
      <tr><th style="color:${BRAND.muted};font-size:11px;text-align:left;padding:8px;border-bottom:1px solid rgba(245,197,66,0.12);text-transform:uppercase;letter-spacing:0.5px">Action</th><th style="color:${BRAND.muted};font-size:11px;text-align:left;padding:8px;border-bottom:1px solid rgba(245,197,66,0.12);text-transform:uppercase;letter-spacing:0.5px">Status</th><th style="color:${BRAND.muted};font-size:11px;text-align:right;padding:8px;border-bottom:1px solid rgba(245,197,66,0.12);text-transform:uppercase;letter-spacing:0.5px">Confidence</th></tr>
      ${resultRows}
    </table>` : ''}
    <div style="text-align:center;margin-top:16px">${ctaButton(dashboardUrl, 'View Full Report', BRAND.blue)}</div>`;

  const html = wrapEmail(card, BRAND.blue);
  const text = `[RUN REPORT] ${catalystName}\n\nTotal: ${runSummary.total} | Completed: ${runSummary.completed} | Exceptions: ${runSummary.exceptions} | Pending: ${runSummary.pending + runSummary.escalated}\n\n${topResults.map(r => `${r.action}: ${r.status} (${(r.confidence * 100).toFixed(0)}%)`).join('\n')}\n\nView full report: ${dashboardUrl}\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Weekly Digest Email Template (§9.1) ──

export function getWeeklyDigestEmailTemplate(data: {
  healthScore: number;
  newSignals: number;
  newRcas: number;
  overduePrescriptions: number;
  recoveredValue: number;
  roiMultiple: number;
}): { html: string; text: string } {
  const healthColor = data.healthScore >= 70 ? BRAND.green : data.healthScore >= 40 ? BRAND.amber : BRAND.red;

  const card = `
    ${badge('Weekly Digest', BRAND.accent, '#16161e')}
    <h2 style="color:${BRAND.text};font-size:20px;margin:16px 0 12px;font-weight:600">Your Week in Review</h2>
    <p style="color:${BRAND.muted};font-size:13px;margin:0 0 20px">Here's what Atheon Intelligence observed this week.</p>
    <div style="display:flex;gap:12px;margin:16px 0">
      ${statBox('Health Score', `${Math.round(data.healthScore)}/100`, healthColor)}
      ${statBox('New Signals', data.newSignals)}
      ${statBox('New RCAs', data.newRcas)}
    </div>
    <div style="display:flex;gap:12px;margin:16px 0">
      ${statBox('Overdue Rx', data.overduePrescriptions, data.overduePrescriptions > 0 ? BRAND.red : BRAND.green)}
      ${statBox('Recovered', `R${(data.recoveredValue / 1000).toFixed(0)}k`, BRAND.green)}
      ${statBox('ROI', `${data.roiMultiple.toFixed(1)}x`)}
    </div>
    ${data.overduePrescriptions > 0 ? `<p style="color:${BRAND.amber};font-size:13px;margin:16px 0 0">⚠ ${data.overduePrescriptions} prescription(s) are overdue. Please review and action immediately.</p>` : ''}
    <div style="text-align:center;margin-top:20px">${ctaButton('https://atheon.vantax.co.za', 'Open Dashboard')}</div>`;

  const html = wrapEmail(card, BRAND.accent);
  const text = `Atheon Weekly Digest\n\nHealth: ${Math.round(data.healthScore)}/100\nNew Signals: ${data.newSignals}\nNew RCAs: ${data.newRcas}\nOverdue Prescriptions: ${data.overduePrescriptions}\nRecovered: R${(data.recoveredValue / 1000).toFixed(0)}k\nROI: ${data.roiMultiple.toFixed(1)}x\n\nOpen Dashboard: https://atheon.vantax.co.za\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Email Sending Infrastructure ──

async function getMsGraphToken(env: Env): Promise<string> {
  const tenantId = env.AZURE_AD_TENANT_ID;
  const clientId = env.AZURE_AD_CLIENT_ID;
  const clientSecret = env.AZURE_AD_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Azure AD credentials (AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET)');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`Azure AD token error (${resp.status}): ${errorText}`);
  }

  const data = await resp.json<{ access_token: string }>();
  return data.access_token;
}

export async function sendEmail(payload: EmailPayload, env: Env): Promise<EmailResult> {
  const id = crypto.randomUUID();
  const senderEmail = payload.from || 'atheon@vantax.co.za';

  try {
    const accessToken = await getMsGraphToken(env);

    const graphPayload = {
      message: {
        subject: payload.subject,
        body: {
          contentType: 'HTML',
          content: payload.htmlBody,
        },
        toRecipients: payload.to.map(email => ({
          emailAddress: { address: email },
        })),
        ...(payload.replyTo ? {
          replyTo: [{ emailAddress: { address: payload.replyTo } }],
        } : {}),
      },
      saveToSentItems: false,
    };

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;
    const resp = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphPayload),
    });

    if (resp.ok || resp.status === 202) {
      return { id, sent: true, channel: 'msgraph' };
    }

    const errorText = await resp.text().catch(() => '');
    logError('email.send.http-error', new Error(`MS Graph HTTP ${resp.status}`), {
      tenantId: payload.tenantId,
      layer: 'email',
      action: 'email.send.http-error',
    }, { emailId: id, status: resp.status, errorSnippet: errorText.slice(0, 500), recipientCount: payload.to.length });
    return { id, sent: false, channel: 'queued', error: `MS Graph HTTP ${resp.status}: ${errorText}` };
  } catch (err) {
    logError('email.send.exception', err, {
      tenantId: payload.tenantId,
      layer: 'email',
      action: 'email.send.exception',
    }, { emailId: id, recipientCount: payload.to.length });
    return { id, sent: false, channel: 'queued', error: (err as Error).message };
  }
}

export async function queueEmail(db: D1Database, payload: EmailPayload): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(id, payload.tenantId, JSON.stringify(payload.to), payload.subject, payload.htmlBody, payload.textBody || '', 'pending').run();
  return id;
}

export async function sendOrQueueEmail(db: D1Database, payload: EmailPayload, env: Env): Promise<EmailResult> {
  const result = await sendEmail(payload, env);

  if (!result.sent) {
    const queueId = await queueEmail(db, payload);
    return { id: queueId, sent: false, channel: 'queued', error: result.error };
  }

  await db.prepare(
    "INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
  ).bind(result.id, payload.tenantId, JSON.stringify(payload.to), payload.subject, payload.htmlBody, payload.textBody || '', 'sent').run().catch(() => {});

  return result;
}


// TASK-018: Email Service Hardening - Circuit breaker + retry
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const emailCircuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

function checkCircuitBreaker(): boolean {
  if (!emailCircuitBreaker.isOpen) return true;
  
  // Check if timeout has elapsed (half-open state)
  if (Date.now() - emailCircuitBreaker.lastFailure > CIRCUIT_BREAKER_TIMEOUT) {
    emailCircuitBreaker.isOpen = false;
    emailCircuitBreaker.failures = 0;
    return true;
  }
  
  return false;
}

function recordEmailFailure(): void {
  emailCircuitBreaker.failures++;
  emailCircuitBreaker.lastFailure = Date.now();
  if (emailCircuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    emailCircuitBreaker.isOpen = true;
    console.error('[EMAIL] Circuit breaker OPEN - too many failures');
  }
}

function recordEmailSuccess(): void {
  emailCircuitBreaker.failures = 0;
  emailCircuitBreaker.isOpen = false;
}

export { checkCircuitBreaker, recordEmailFailure, recordEmailSuccess };

// ── Merged from email-hardened.ts (SPEC-017) ──

export interface EmailDeliveryRecord {
  id: string;
  tenantId: string;
  to: string;
  subject: string;
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed';
  provider: string;
  attemptCount: number;
  lastAttemptAt: string;
  error?: string;
  messageId?: string;
}

export interface EmailRateLimit {
  maxPerHour: number;
  maxPerDay: number;
  burstLimit: number;
}

const DEFAULT_EMAIL_RATE_LIMITS: EmailRateLimit = {
  maxPerHour: 100,
  maxPerDay: 1000,
  burstLimit: 10,
};

export async function checkEmailRateLimit(
  cache: KVNamespace,
  tenantId: string,
  limits: EmailRateLimit = DEFAULT_EMAIL_RATE_LIMITS,
): Promise<{ allowed: boolean; reason?: string }> {
  const hourKey = `email_rate:${tenantId}:hour:${Math.floor(Date.now() / 3600000)}`;
  const dayKey = `email_rate:${tenantId}:day:${new Date().toISOString().split('T')[0]}`;
  const [hourCount, dayCount] = await Promise.all([
    cache.get(hourKey).then(v => parseInt(v || '0', 10)),
    cache.get(dayKey).then(v => parseInt(v || '0', 10)),
  ]);
  if (hourCount >= limits.maxPerHour) return { allowed: false, reason: `Hourly email limit exceeded (${limits.maxPerHour}/hour)` };
  if (dayCount >= limits.maxPerDay) return { allowed: false, reason: `Daily email limit exceeded (${limits.maxPerDay}/day)` };
  await Promise.all([
    cache.put(hourKey, String(hourCount + 1), { expirationTtl: 3600 }),
    cache.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 }),
  ]);
  return { allowed: true };
}

export async function isEmailBounced(db: D1Database, email: string): Promise<boolean> {
  try {
    const result = await db.prepare(
      "SELECT 1 FROM email_bounces WHERE email = ? AND created_at > datetime('now', '-30 days')"
    ).bind(email.toLowerCase()).first();
    return !!result;
  } catch { return false; }
}

export async function recordBounce(db: D1Database, email: string, reason: string): Promise<void> {
  try {
    await db.prepare(
      "INSERT OR REPLACE INTO email_bounces (id, email, reason, bounce_count, created_at) VALUES (?, ?, ?, COALESCE((SELECT bounce_count + 1 FROM email_bounces WHERE email = ?), 1), datetime('now'))"
    ).bind(crypto.randomUUID(), email.toLowerCase(), reason, email.toLowerCase()).run();
  } catch (err) { console.error('Failed to record bounce:', err); }
}

export function validateEmailTemplate(template: {
  to: string[];
  subject: string;
  htmlBody?: string;
  textBody?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!template.to || template.to.length === 0) errors.push('At least one recipient is required');
  else if (template.to.some(email => !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))) errors.push('One or more recipient email addresses are invalid');
  if (!template.subject || template.subject.trim().length === 0) errors.push('Email subject is required');
  if (template.subject && template.subject.length > 200) errors.push('Subject must be under 200 characters');
  if (!template.htmlBody && !template.textBody) errors.push('Either HTML or text body is required');
  return { valid: errors.length === 0, errors };
}

export function sanitizeEmailHtml(html: string): string {
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="');
  return clean;
}
