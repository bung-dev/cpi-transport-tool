import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { RadioControl } from '../../components/ui/Radio';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useTenants } from '../tenants/TenantContext';

export function TenantSelect() {
  const base = useId();
  const { tenants, sourceTenantId, targetTenantId, setSourceTenantId, setTargetTenantId, reload, openTenantsTab } = useTenants();
  return (
    <Card title="테넌트">
      {tenants.state === 'loading' && <ListSkeleton />}
      {tenants.state === 'error' && <ErrorAlert error={tenants.error} onRetry={() => void reload()} />}
      {tenants.state === 'success' && (tenants.data.tenants.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState title="등록된 테넌트가 없습니다" />
          <Button onClick={openTenantsTab}>테넌트 탭으로 이동</Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {[
            { key: 'source', title: '원본 테넌트', value: sourceTenantId, select: setSourceTenantId },
            { key: 'target', title: '대상 테넌트', value: targetTenantId, select: setTargetTenantId },
          ].map(group => (
            <fieldset key={group.key} role="radiogroup" className="min-w-0">
              <legend className="mb-1.5 text-xs font-medium text-ink-tertiary">{group.title}</legend>
              <div className="flex min-w-0 flex-col gap-1">
                {tenants.data.tenants.map((tenant, i) => {
                  const titleId = base + '-' + group.key + '-' + i + '-title';
                  const descId = base + '-' + group.key + '-' + i + '-desc';
                  return (
                    <label key={tenant.id} className="flex min-h-10 min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-surface-hover">
                      <RadioControl name={base + '-' + group.key} value={tenant.id} className="mt-0.5"
                        checked={group.value === tenant.id} onChange={() => group.select(tenant.id)}
                        aria-labelledby={titleId} aria-describedby={descId} />
                      <span className="min-w-0">
                        <span id={titleId} className="block font-medium break-all">{tenant.name}</span>
                        <span id={descId} className="block text-xs text-ink-tertiary break-all">{tenant.apiHost}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ))}
    </Card>
  );
}
