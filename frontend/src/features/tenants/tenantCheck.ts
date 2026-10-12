import type { TenantCheck } from '../../api/types';
export const TENANT_CHECK_LABELS: Record<TenantCheck, string> = {
  OK: '연결됨', TOKEN_FAILED: '인증 실패', API_FORBIDDEN: '권한 없음', UNREACHABLE: '연결 안 됨', ERROR: '오류',
};
export function tenantCheckLabel(check?: TenantCheck, failed = false) {
  return failed ? '확인 실패' : check ? TENANT_CHECK_LABELS[check] : '확인 중';
}
