import type { ReactNode } from 'react';
import { DEFAULT_TENANT_CONTEXT, TenantContext, type TenantContextValue } from '../features/tenants/TenantContext';
import { TENANTS_OK, TENANT_STATUS_OK } from './tenantFixtures';
export function TestTenantProvider({ children, value }: { children: ReactNode; value?: Partial<TenantContextValue> }) {
  return <TenantContext.Provider value={{ ...DEFAULT_TENANT_CONTEXT, tenants: { state: 'success', data: TENANTS_OK },
    status: { state: 'success', data: TENANT_STATUS_OK }, readOnly: false, sourceTenantId: 'DEV', targetTenantId: 'PRD', ...value }}>{children}</TenantContext.Provider>;
}
