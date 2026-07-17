import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the three consolidated surfaces — Assurance is a shell; its only logic
// is the section switcher, so we don't drag in the children's API paths.
vi.mock('@/pages/CompliancePage', () => ({ ComplianceEvidence: () => <div>EVIDENCE_PANEL</div> }));
vi.mock('@/pages/AuditPage', () => ({ AuditPage: () => <div>AUDIT_PANEL</div> }));
vi.mock('@/pages/DataGovernancePage', () => ({ DataGovernancePage: () => <div>GOVERNANCE_PANEL</div> }));

import { AssurancePage } from '@/pages/AssurancePage';

describe('AssurancePage', () => {
  it('lands on evidence, and switches to the other sections on demand', () => {
    render(<AssurancePage />);
    // default section
    expect(screen.getByText('EVIDENCE_PANEL')).toBeTruthy();
    expect(screen.queryByText('AUDIT_PANEL')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Audit log/i }));
    expect(screen.getByText('AUDIT_PANEL')).toBeTruthy();
    expect(screen.queryByText('EVIDENCE_PANEL')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /^Governance/i }));
    expect(screen.getByText('GOVERNANCE_PANEL')).toBeTruthy();
  });
});
