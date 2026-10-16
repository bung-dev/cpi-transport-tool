import { Badge } from '../../components/ui/Badge';
import { TenantCheckBadge } from './TenantCheckBadge';
import { useTenants } from './TenantContext';

export function StatusChips() {
  const { tenants, status, readOnly, sourceTenantId, targetTenantId, refreshStatus } = useTenants();
  return (
    <div className="ml-auto flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
      {([{ label: '원본', id: sourceTenantId }, { label: '대상', id: targetTenantId }]).map(({ label, id }) => {
        const tenant = tenants.state === 'success' ? tenants.data.tenants.find(t => t.id === id) : undefined;
        const name = tenant?.name ?? id;
        const check = status.state === 'success' ? status.data.tenants.find(t => t.id === id)?.check : undefined;
        return (
          <button key={label} type="button" aria-busy={status.state === 'loading'}
            onClick={() => { if (status.state !== 'loading') void refreshStatus(); }}
            className="flex min-w-0 flex-1 flex-col items-center rounded-md text-xs transition-colors duration-150 hover:bg-surface-hover [&>span:last-child]:max-w-full [&>span:last-child]:px-1 [&_[data-badge-dot]]:hidden sm:[&>span:last-child]:px-2.5 sm:[&_[data-badge-dot]]:block">
            {id ? <><span className="w-full min-w-0 max-w-[72px] truncate sm:max-w-[160px]">{label} {name}</span>{' '}
              <TenantCheckBadge check={check} failed={status.state === 'error'} /></>
              : <Badge tone="neutral"><span>{label} 선택 안 됨</span></Badge>}
          </button>
        );
      })}
      {readOnly === true && <Badge className="max-w-[48px] shrink-0 px-1 text-center sm:max-w-none sm:px-2.5">읽기 전용</Badge>}
    </div>
  );
}
