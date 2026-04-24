/**
 * PII Redaction Unit Tests
 *
 * Verifies that the conservative pattern-based redactor catches the common
 * PII classes we care about (email, phone, SA ID, credit card, SSN, IP,
 * IBAN) without over-firing on plain prose.
 *
 * Remember: false positives are OK (redacting too much is safe). False
 * negatives are not — if a test here fails because a rule stopped matching,
 * the fix is to widen the rule, not to lower the bar.
 */
import { describe, it, expect } from 'vitest';
import {
  redactPII,
  scrub,
  luhnValid,
  DEFAULT_RULES,
  type RedactionRule,
} from '../services/pii-redaction';

describe('PII Redaction', () => {
  describe('Default rules — happy path', () => {
    it('redacts an email address', () => {
      const result = redactPII('Contact me at john.doe+work@example.com for details.');
      expect(result.redacted).toBe('Contact me at [EMAIL] for details.');
      expect(result.matches.find(m => m.rule === 'email')?.count).toBe(1);
      expect(result.anyRedactions).toBe(true);
    });

    it('redacts an international phone number with separators', () => {
      const result = redactPII('Call me on +27 82 555 1234 when ready.');
      expect(result.redacted).toContain('[PHONE]');
      expect(result.matches.some(m => m.rule === 'phone')).toBe(true);
    });

    it('redacts a 13-digit South African ID number', () => {
      const result = redactPII('My SA ID is 8001015009087 on file.');
      expect(result.redacted).toBe('My SA ID is [SA_ID] on file.');
      expect(result.matches.find(m => m.rule === 'sa_id')?.count).toBe(1);
    });

    it('redacts a 16-digit credit card number', () => {
      const result = redactPII('Card: 4111 1111 1111 1111 expires 12/28.');
      expect(result.redacted).toContain('[CREDIT_CARD]');
      expect(result.matches.some(m => m.rule === 'credit_card')).toBe(true);
    });

    it('redacts a US SSN in dashed form', () => {
      const result = redactPII('SSN 123-45-6789 on the form.');
      expect(result.redacted).toBe('SSN [SSN] on the form.');
      expect(result.matches.find(m => m.rule === 'ssn')?.count).toBe(1);
    });

    it('redacts an IPv4 address', () => {
      const result = redactPII('Request came from 192.168.1.42 yesterday.');
      expect(result.redacted).toBe('Request came from [IP] yesterday.');
      expect(result.matches.find(m => m.rule === 'ip')?.count).toBe(1);
    });

    it('redacts an IBAN', () => {
      const result = redactPII('Wire to GB82 WEST 1234 5698 7654 32 by Friday.');
      expect(result.redacted).toContain('[IBAN]');
      expect(result.matches.some(m => m.rule === 'iban')).toBe(true);
    });
  });

  describe('False-positive discipline', () => {
    it('does not redact plain prose with a time reference', () => {
      const result = redactPII('Call me at 3pm about the report.');
      expect(result.anyRedactions).toBe(false);
      expect(result.redacted).toBe('Call me at 3pm about the report.');
    });

    it('does not redact short numeric strings like order counts', () => {
      const result = redactPII('We shipped 42 units this quarter.');
      expect(result.anyRedactions).toBe(false);
      expect(result.redacted).toBe('We shipped 42 units this quarter.');
    });
  });

  describe('Edge cases', () => {
    it('returns an empty result for empty string', () => {
      const result = redactPII('');
      expect(result).toEqual({ redacted: '', matches: [], anyRedactions: false });
    });

    it('returns an empty result for null input', () => {
      const result = redactPII(null);
      expect(result.redacted).toBe('');
      expect(result.anyRedactions).toBe(false);
    });

    it('returns an empty result for undefined input', () => {
      const result = redactPII(undefined);
      expect(result.redacted).toBe('');
      expect(result.anyRedactions).toBe(false);
    });
  });

  describe('Multiple rules', () => {
    it('reports which rule types fired when several match', () => {
      const input = 'Reach me at jane@corp.com or 555-123-4567 — my ID is 8001015009087.';
      const result = redactPII(input);
      const ruleNames = result.matches.map(m => m.rule).sort();
      expect(ruleNames).toContain('email');
      expect(ruleNames).toContain('sa_id');
      // Phone rule should fire on the dashed number
      expect(ruleNames).toContain('phone');
      expect(result.redacted).not.toContain('jane@corp.com');
      expect(result.redacted).not.toContain('8001015009087');
    });

    it('counts multiple matches of the same rule', () => {
      const result = redactPII('Emails: a@b.com, c@d.com, e@f.com.');
      const email = result.matches.find(m => m.rule === 'email');
      expect(email?.count).toBe(3);
      // All three should be replaced
      expect((result.redacted.match(/\[EMAIL\]/g) || []).length).toBe(3);
    });
  });

  describe('Custom rules', () => {
    it('accepts a custom rule set and overrides defaults', () => {
      const customRules: RedactionRule[] = [
        { name: 'project_code', pattern: /\bPROJ-\d{4}\b/g, replacement: '[PROJECT]' },
      ];
      const result = redactPII('Update on PROJ-1234 vs PROJ-5678 — email sales@co.com.', customRules);
      expect(result.redacted).toBe('Update on [PROJECT] vs [PROJECT] — email sales@co.com.');
      // Email rule NOT in custom set — so the email should survive
      expect(result.redacted).toContain('sales@co.com');
      expect(result.matches.find(m => m.rule === 'project_code')?.count).toBe(2);
    });

    it('throws when a rule is missing the /g flag', () => {
      const badRule: RedactionRule = { name: 'bad', pattern: /foo/, replacement: '[X]' };
      expect(() => redactPII('foo bar foo', [badRule])).toThrow(/\/g flag/);
    });
  });

  describe('Helpers', () => {
    it('scrub() returns only the redacted text', () => {
      expect(scrub('hi me@x.com there')).toBe('hi [EMAIL] there');
      expect(scrub(null)).toBe('');
    });

    it('luhnValid returns true for a valid test card number', () => {
      // Visa test number
      expect(luhnValid('4111111111111111')).toBe(true);
      // With spaces
      expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    });

    it('luhnValid returns false for a non-card number', () => {
      expect(luhnValid('1234567890123456')).toBe(false);
    });

    it('DEFAULT_RULES exports the expected rule names', () => {
      const names = DEFAULT_RULES.map(r => r.name).sort();
      expect(names).toEqual(['credit_card', 'email', 'iban', 'ip', 'phone', 'sa_id', 'ssn']);
    });
  });
});
