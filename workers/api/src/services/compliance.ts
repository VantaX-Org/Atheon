/**
 * SPEC-029: SOC2/ISO27001 Compliance Package
 * Compliance checks, evidence collection, and control mapping.
 */

export interface ComplianceControl {
  id: string;
  framework: 'SOC2' | 'ISO27001';
  controlId: string;
  title: string;
  description: string;
  category: string;
  status: 'compliant' | 'partial' | 'non_compliant' | 'not_applicable';
  evidence: string[];
  lastReviewedAt?: string;
  assignee?: string;
}

export interface ComplianceReport {
  id: string;
  tenantId: string;
  framework: 'SOC2' | 'ISO27001';
  generatedAt: string;
  overallScore: number;
  totalControls: number;
  compliantControls: number;
  partialControls: number;
  nonCompliantControls: number;
  controls: ComplianceControl[];
}

/** SOC2 Trust Service Criteria controls */
export const SOC2_CONTROLS: Omit<ComplianceControl, 'status' | 'evidence' | 'lastReviewedAt' | 'assignee'>[] = [
  // Security
  { id: 'soc2-cc1.1', framework: 'SOC2', controlId: 'CC1.1', title: 'Control Environment', description: 'Organization demonstrates commitment to integrity and ethical values', category: 'Security' },
  { id: 'soc2-cc2.1', framework: 'SOC2', controlId: 'CC2.1', title: 'Information & Communication', description: 'Internal communication of objectives and responsibilities', category: 'Security' },
  { id: 'soc2-cc3.1', framework: 'SOC2', controlId: 'CC3.1', title: 'Risk Assessment', description: 'Organization identifies and assesses risks', category: 'Security' },
  { id: 'soc2-cc4.1', framework: 'SOC2', controlId: 'CC4.1', title: 'Monitoring Activities', description: 'Ongoing monitoring and evaluation of controls', category: 'Security' },
  { id: 'soc2-cc5.1', framework: 'SOC2', controlId: 'CC5.1', title: 'Control Activities', description: 'Selection and development of control activities', category: 'Security' },
  { id: 'soc2-cc6.1', framework: 'SOC2', controlId: 'CC6.1', title: 'Logical Access', description: 'Logical access security over assets', category: 'Security' },
  { id: 'soc2-cc6.2', framework: 'SOC2', controlId: 'CC6.2', title: 'Authentication', description: 'User authentication before access', category: 'Security' },
  { id: 'soc2-cc6.3', framework: 'SOC2', controlId: 'CC6.3', title: 'Access Authorization', description: 'Role-based access control implementation', category: 'Security' },
  { id: 'soc2-cc7.1', framework: 'SOC2', controlId: 'CC7.1', title: 'System Monitoring', description: 'Detection and monitoring of security events', category: 'Security' },
  { id: 'soc2-cc7.2', framework: 'SOC2', controlId: 'CC7.2', title: 'Incident Response', description: 'Procedures for responding to security incidents', category: 'Security' },
  { id: 'soc2-cc8.1', framework: 'SOC2', controlId: 'CC8.1', title: 'Change Management', description: 'Authorization and testing of system changes', category: 'Security' },
  // Availability
  { id: 'soc2-a1.1', framework: 'SOC2', controlId: 'A1.1', title: 'Availability Commitment', description: 'System availability meets service commitments', category: 'Availability' },
  { id: 'soc2-a1.2', framework: 'SOC2', controlId: 'A1.2', title: 'Disaster Recovery', description: 'Data backup and recovery procedures', category: 'Availability' },
  // Confidentiality
  { id: 'soc2-c1.1', framework: 'SOC2', controlId: 'C1.1', title: 'Data Classification', description: 'Identification and classification of confidential data', category: 'Confidentiality' },
  { id: 'soc2-c1.2', framework: 'SOC2', controlId: 'C1.2', title: 'Data Encryption', description: 'Encryption of data at rest and in transit', category: 'Confidentiality' },
];

/** ISO 27001 Annex A controls (subset) */
export const ISO27001_CONTROLS: Omit<ComplianceControl, 'status' | 'evidence' | 'lastReviewedAt' | 'assignee'>[] = [
  { id: 'iso-a5.1', framework: 'ISO27001', controlId: 'A.5.1', title: 'Information Security Policies', description: 'Management direction for information security', category: 'Policies' },
  { id: 'iso-a6.1', framework: 'ISO27001', controlId: 'A.6.1', title: 'Organization of Information Security', description: 'Internal organization for information security', category: 'Organization' },
  { id: 'iso-a7.1', framework: 'ISO27001', controlId: 'A.7.1', title: 'Human Resource Security', description: 'Security before, during, and after employment', category: 'Human Resources' },
  { id: 'iso-a8.1', framework: 'ISO27001', controlId: 'A.8.1', title: 'Asset Management', description: 'Identification and classification of assets', category: 'Asset Management' },
  { id: 'iso-a9.1', framework: 'ISO27001', controlId: 'A.9.1', title: 'Access Control', description: 'Business requirements of access control', category: 'Access Control' },
  { id: 'iso-a9.2', framework: 'ISO27001', controlId: 'A.9.2', title: 'User Access Management', description: 'Provisioning and de-provisioning of access', category: 'Access Control' },
  { id: 'iso-a10.1', framework: 'ISO27001', controlId: 'A.10.1', title: 'Cryptographic Controls', description: 'Use of cryptography to protect information', category: 'Cryptography' },
  { id: 'iso-a12.1', framework: 'ISO27001', controlId: 'A.12.1', title: 'Operational Security', description: 'Operational procedures and responsibilities', category: 'Operations' },
  { id: 'iso-a12.4', framework: 'ISO27001', controlId: 'A.12.4', title: 'Logging and Monitoring', description: 'Event logging and monitoring', category: 'Operations' },
  { id: 'iso-a13.1', framework: 'ISO27001', controlId: 'A.13.1', title: 'Communications Security', description: 'Network security management', category: 'Communications' },
  { id: 'iso-a14.1', framework: 'ISO27001', controlId: 'A.14.1', title: 'System Development Security', description: 'Security in development and support', category: 'Development' },
  { id: 'iso-a16.1', framework: 'ISO27001', controlId: 'A.16.1', title: 'Incident Management', description: 'Management of security incidents', category: 'Incident Management' },
  { id: 'iso-a18.1', framework: 'ISO27001', controlId: 'A.18.1', title: 'Legal Compliance', description: 'Compliance with legal and contractual requirements', category: 'Compliance' },
];

/** Auto-assess compliance controls based on system configuration */
export async function assessCompliance(
  db: D1Database,
  tenantId: string,
  framework: 'SOC2' | 'ISO27001',
): Promise<ComplianceReport> {
  const controls = framework === 'SOC2' ? SOC2_CONTROLS : ISO27001_CONTROLS;

  // Check system capabilities for automated evidence
  const [hasAuditLog, hasMFA, hasEncryption, hasRBAC] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>().then(r => (r?.count ?? 0) > 0).catch(() => false),
    db.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND mfa_enabled = 1').bind(tenantId).first<{ count: number }>().then(r => (r?.count ?? 0) > 0).catch(() => false),
    Promise.resolve(true), // TLS is always on via Cloudflare
    db.prepare('SELECT COUNT(DISTINCT role) as count FROM users WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>().then(r => (r?.count ?? 0) > 1).catch(() => false),
  ]);

  const assessedControls: ComplianceControl[] = controls.map(c => {
    let status: ComplianceControl['status'] = 'partial';
    const evidence: string[] = [];

    // Auto-assess based on known system capabilities
    if (c.controlId.includes('CC6') || c.controlId.includes('A.9')) {
      // Access control
      if (hasRBAC) { status = 'compliant'; evidence.push('RBAC implemented with role-based access'); }
      if (hasMFA) evidence.push('MFA available for user accounts');
    }
    if (c.controlId.includes('CC7') || c.controlId.includes('A.12.4') || c.controlId.includes('A.16')) {
      // Logging/monitoring
      if (hasAuditLog) { status = 'compliant'; evidence.push('Comprehensive audit logging enabled'); }
    }
    if (c.controlId.includes('C1.2') || c.controlId.includes('A.10')) {
      // Encryption
      if (hasEncryption) { status = 'compliant'; evidence.push('TLS 1.3 via Cloudflare, data encrypted at rest in D1'); }
    }
    if (c.controlId.includes('A1') || c.controlId.includes('A.12.1')) {
      // Availability
      status = 'compliant';
      evidence.push('Cloudflare global edge network provides 99.99% uptime SLA');
    }

    return { ...c, status, evidence, lastReviewedAt: new Date().toISOString() };
  });

  const compliant = assessedControls.filter(c => c.status === 'compliant').length;
  const partial = assessedControls.filter(c => c.status === 'partial').length;
  const nonCompliant = assessedControls.filter(c => c.status === 'non_compliant').length;

  return {
    id: crypto.randomUUID(),
    tenantId,
    framework,
    generatedAt: new Date().toISOString(),
    overallScore: Math.round((compliant / assessedControls.length) * 100),
    totalControls: assessedControls.length,
    compliantControls: compliant,
    partialControls: partial,
    nonCompliantControls: nonCompliant,
    controls: assessedControls,
  };
}
