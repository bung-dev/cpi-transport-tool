import { Badge } from '../../components/ui/Badge';
import { badgeTone } from '../../design/statusBadges';
import type { TenantCheck } from '../../api/types';
import { tenantCheckLabel } from './tenantCheck';
export function TenantCheckBadge({ check, failed = false }: { check?: TenantCheck; failed?: boolean }) {
  return <Badge dot tone={badgeTone('tenantCheck', failed ? 'REQUEST_FAILED' : check ?? '')}>{tenantCheckLabel(check, failed)}</Badge>;
}
