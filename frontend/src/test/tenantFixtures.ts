import type { TenantsResponse, TenantStatusResponse } from '../api/types';
export const TENANTS_OK: TenantsResponse = { store: 'OK', tenants: ['DEV', 'PRD'].map(id => ({ id, name: id, source: 'env', apiHost: 'localhost', createdAt: null })) };
export const TENANT_STATUS_OK: TenantStatusResponse = { readOnly: false, tenants: TENANTS_OK.tenants.map(t => ({ id: t.id, name: t.name, source: t.source, apiHost: t.apiHost, check: 'OK' })) };
