import type { TenantContextValue } from '../tenants/TenantContext';

export const REGISTER_TENANT_FIRST = '먼저 테넌트를 등록하세요';

// AI-NOTE: 목록을 성공적으로 읽었고 0개일 때만 "등록" 안내를 한다. 읽는 중·읽기 실패는 목록이 비었는지 모르므로 해당하지 않는다. sourceTenantId가 null인 모든 경우로 넓히면 안 된다 (근거: REQ-312 AC-4)
export function hasNoTenants(tenants: TenantContextValue['tenants']): boolean {
  return tenants.state === 'success' && tenants.data.tenants.length === 0;
}
