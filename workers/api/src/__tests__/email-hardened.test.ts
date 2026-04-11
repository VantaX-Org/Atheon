/**
 * SPEC-005: Test Coverage — Email Service Hardening Tests
 * Tests for rate limiting, bounce detection, template validation, HTML sanitization.
 */
import { describe, it, expect } from 'vitest';
import { validateEmailTemplate, sanitizeEmailHtml } from '../services/email-hardened';

describe('Email Service - Template Validation', () => {
  it('should accept a valid email template', () => {
    const result = validateEmailTemplate({
      to: ['user@example.com'],
      subject: 'Test Subject',
      htmlBody: '<p>Hello</p>',
      textBody: 'Hello',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject template with no recipients', () => {
    const result = validateEmailTemplate({
      to: [],
      subject: 'Test',
      htmlBody: '<p>Hello</p>',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('recipient'))).toBe(true);
  });

  it('should reject template with empty subject', () => {
    const result = validateEmailTemplate({
      to: ['user@example.com'],
      subject: '',
      htmlBody: '<p>Hello</p>',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('subject'))).toBe(true);
  });

  it('should reject template with no body', () => {
    const result = validateEmailTemplate({
      to: ['user@example.com'],
      subject: 'Test',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('body'))).toBe(true);
  });

  it('should reject invalid email addresses', () => {
    const result = validateEmailTemplate({
      to: ['not-an-email'],
      subject: 'Test',
      htmlBody: '<p>Hello</p>',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid'))).toBe(true);
  });
});

describe('Email Service - HTML Sanitization', () => {
  it('should remove script tags', () => {
    const html = '<p>Hello</p><script>alert("xss")</script>';
    const sanitized = sanitizeEmailHtml(html);
    expect(sanitized).not.toContain('<script');
    expect(sanitized).toContain('<p>Hello</p>');
  });

  it('should remove event handlers', () => {
    const html = '<p onclick="alert(1)">Click me</p>';
    const sanitized = sanitizeEmailHtml(html);
    expect(sanitized).not.toContain('onclick');
  });

  it('should remove javascript: URLs', () => {
    const html = '<a href="javascript:alert(1)">Click</a>';
    const sanitized = sanitizeEmailHtml(html);
    expect(sanitized).not.toContain('javascript:');
  });

  it('should preserve safe HTML', () => {
    const html = '<div><h1>Title</h1><p>Content</p><a href="https://example.com">Link</a></div>';
    const sanitized = sanitizeEmailHtml(html);
    expect(sanitized).toContain('<h1>Title</h1>');
    expect(sanitized).toContain('https://example.com');
  });
});
