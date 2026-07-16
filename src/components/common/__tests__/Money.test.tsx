import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Money } from '../Money';

// useTenantCurrency reads the store; ZAR is the default, so no mocking needed.
afterEach(cleanup);

describe('<Money>', () => {
  it('confirmed renders in ink (no unverified treatment) with exact value in a11y tree', () => {
    render(<Money value={4_197_310} provenance={{ kind: 'confirmed' }} />);
    const el = screen.getByText('R4.19m'); // truncated, never rounded up (F9)
    expect(el.getAttribute('aria-label')).toBe('R 4 197 310');
    expect(el.className).toContain('t-primary');
    expect(el.className).not.toContain('opacity-60');
  });

  it('unverified greys + dots + labels "needs review", never counted', () => {
    render(<Money value={120_000} provenance={{ kind: 'unverified' }} />);
    const el = screen.getByText('R120k');
    expect(el.className).toContain('decoration-dotted');
    expect(el.getAttribute('aria-label')).toContain('needs review, not counted');
  });

  it('null renders an em-dash (no coerced zero) and labels "No value"', () => {
    render(<Money value={null} provenance={{ kind: 'confirmed' }} />);
    const el = screen.getByText('—');
    expect(el.getAttribute('aria-label')).toBe('No value');
  });

  it('receipt-backed + handler → button that opens the receipt', () => {
    const onOpen = vi.fn();
    render(<Money value={500_000} provenance={{ kind: 'confirmed', receiptId: 'r-1' }} onOpenReceipt={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('r-1');
  });

  it('no handler → plain text even when receipt-backed', () => {
    render(<Money value={500_000} provenance={{ kind: 'confirmed', receiptId: 'r-1' }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
