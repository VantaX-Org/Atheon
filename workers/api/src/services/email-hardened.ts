/**
 * SPEC-017: Email Service Hardening
 * Rate limiting, bounce tracking, template validation, and delivery monitoring.
 */

/** Track email delivery attempts and bounces */
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

/** Per-tenant email rate limit config */
export interface EmailRateLimit {
  maxPerHour: number;
  maxPerDay: number;
  burstLimit: number;
}

const DEFAULT_RATE_LIMITS: EmailRateLimit = {
  maxPerHour: 100,
  maxPerDay: 1000,
  burstLimit: 10,
};

/** Check if email sending is within rate limits */
export async function checkEmailRateLimit(
  cache: KVNamespace,
  tenantId: string,
  limits: EmailRateLimit = DEFAULT_RATE_LIMITS,
): Promise<{ allowed: boolean; reason?: string }> {
  const hourKey = `email_rate:${tenantId}:hour:${Math.floor(Date.now() / 3600000)}`;
  const dayKey = `email_rate:${tenantId}:day:${new Date().toISOString().split('T')[0]}`;

  const [hourCount, dayCount] = await Promise.all([
    cache.get(hourKey).then(v => parseInt(v || '0', 10)),
    cache.get(dayKey).then(v => parseInt(v || '0', 10)),
  ]);

  if (hourCount >= limits.maxPerHour) {
    return { allowed: false, reason: `Hourly email limit exceeded (${limits.maxPerHour}/hour)` };
  }
  if (dayCount >= limits.maxPerDay) {
    return { allowed: false, reason: `Daily email limit exceeded (${limits.maxPerDay}/day)` };
  }

  // Increment counters
  await Promise.all([
    cache.put(hourKey, String(hourCount + 1), { expirationTtl: 3600 }),
    cache.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 }),
  ]);

  return { allowed: true };
}

/** Check if an email address is on the bounce list */
export async function isEmailBounced(db: D1Database, email: string): Promise<boolean> {
  try {
    const result = await db.prepare(
      'SELECT 1 FROM email_bounces WHERE email = ? AND created_at > datetime(\'now\', \'-30 days\')'
    ).bind(email.toLowerCase()).first();
    return !!result;
  } catch {
    return false; // Table may not exist yet
  }
}

/** Record a bounce for an email address */
export async function recordBounce(db: D1Database, email: string, reason: string): Promise<void> {
  try {
    await db.prepare(
      'INSERT OR REPLACE INTO email_bounces (id, email, reason, bounce_count, created_at) VALUES (?, ?, ?, COALESCE((SELECT bounce_count + 1 FROM email_bounces WHERE email = ?), 1), datetime(\'now\'))'
    ).bind(crypto.randomUUID(), email.toLowerCase(), reason, email.toLowerCase()).run();
  } catch (err) {
    console.error('Failed to record bounce:', err);
  }
}

/** Validate email template has required fields */
export function validateEmailTemplate(template: {
  to: string[];
  subject: string;
  htmlBody?: string;
  textBody?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!template.to || template.to.length === 0) {
    errors.push('At least one recipient is required');
  } else if (template.to.some(email => !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))) {
    errors.push('One or more recipient email addresses are invalid');
  }
  if (!template.subject || template.subject.trim().length === 0) {
    errors.push('Email subject is required');
  }
  if (template.subject && template.subject.length > 200) {
    errors.push('Subject must be under 200 characters');
  }
  if (!template.htmlBody && !template.textBody) {
    errors.push('Either HTML or text body is required');
  }

  return { valid: errors.length === 0, errors };
}

/** Sanitize HTML email content to prevent XSS in email clients */
export function sanitizeEmailHtml(html: string): string {
  // Remove script tags
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove event handlers
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: URLs
  clean = clean.replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="');
  return clean;
}
