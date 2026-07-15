import { describe, it, expect } from 'vitest';
import { erpRolesFor } from '../index';

const MANAGER = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const ADMIN = ['superadmin', 'support_admin', 'admin'];

describe('erpRolesFor - read/mutation split on the erp namespace', () => {
  it('loosens only the two read-only source-health GETs to managers', () => {
    expect(erpRolesFor('GET', '/api/erp/connections')).toEqual(MANAGER);
    expect(erpRolesFor('GET', '/api/v1/erp/connections')).toEqual(MANAGER);
    expect(erpRolesFor('GET', '/api/v1/erp/connections/health')).toEqual(MANAGER);
    expect(erpRolesFor('GET', '/api/erp/connections/health')).toEqual(MANAGER);
  });

  it('keeps every erp mutation and sub-resource admin-only', () => {
    // POST to the same read path is a mutation → admin only
    expect(erpRolesFor('POST', '/api/erp/connections')).toEqual(ADMIN);
    // per-connection tools stay admin (test, circuit, sync)
    expect(erpRolesFor('POST', '/api/erp/connections/abc/test')).toEqual(ADMIN);
    expect(erpRolesFor('GET', '/api/erp/connections/abc/circuit')).toEqual(ADMIN);
    expect(erpRolesFor('POST', '/api/erp/sync/abc')).toEqual(ADMIN);
    // companies and anything else under erp stays admin
    expect(erpRolesFor('GET', '/api/erp/companies')).toEqual(ADMIN);
  });
});
