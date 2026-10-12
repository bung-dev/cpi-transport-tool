import { useRef, useState } from 'react';
import { deleteTenant } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { Tenant } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Callout } from '../../components/ui/Callout';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { useTenants } from './TenantContext';
import { TenantCheckBadge } from './TenantCheckBadge';
import { TenantForm } from './TenantForm';
import { TenantDeleteDialog } from './TenantDeleteDialog';
export function TenantTab() {
  const { tenants, status, reload } = useTenants();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const registerRef = useRef<HTMLDivElement>(null);
  const store = tenants.state === 'success' ? tenants.data.store : undefined;
  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true); setError(undefined);
    try {
      await deleteTenant(deleting.id);
      setDeleting(null);
      // Successful deletion removes the opener; return focus to the registration area.
      registerRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      await reload();
    } catch (e) { setError(toApiError(e)); }
    finally { setBusy(false); }
  }
  return <section className="grid min-w-0 gap-5">
    <h2 className="text-xl font-semibold">테넌트</h2>
    <Card title="등록된 테넌트">
      {tenants.state === 'loading' ? <ListSkeleton /> : tenants.state === 'error' ? <ErrorAlert error={tenants.error} onRetry={() => void reload()} /> :
        <ul className="grid min-w-0 gap-3">
          {tenants.data.tenants.length === 0 && <li>등록된 테넌트가 없습니다</li>}
          {tenants.data.tenants.map(t => <li key={t.id} className="min-w-0 rounded-md border border-hairline p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-all font-medium">{t.name}</span><span className="break-all text-sm text-ink-secondary">{t.apiHost}</span>
              <Badge>{t.source === 'env' ? '환경 변수' : '등록'}</Badge>
              <TenantCheckBadge check={status.state === 'success' ? status.data.tenants.find(s => s.id === t.id)?.check : undefined} failed={status.state === 'error'} />
              {t.source === 'registered' && <div className="flex flex-wrap gap-1 sm:ml-auto">
                <Button size="sm" onClick={() => setEditing(t.id)}>수정</Button>
                <Button size="sm" onClick={() => { setDeleting(t); setError(undefined); }}>삭제</Button>
              </div>}
            </div>
            {editing === t.id && <div className="mt-3"><TenantForm tenantId={t.id} disabled={store !== 'OK'} onCancel={() => setEditing(null)} onSuccess={async () => { setEditing(null); await reload(); }} /></div>}
          </li>)}
        </ul>}
    </Card>
    <Card title="테넌트 등록">
      <div ref={registerRef} className="grid min-w-0 gap-3">
        {store === 'NOT_CONFIGURED' && <Callout tone="warning">테넌트 저장소 키(CPI_TENANT_STORE_KEY)가 설정되지 않아 등록할 수 없습니다</Callout>}
        {store === 'UNREADABLE' && <Callout tone="danger">테넌트 저장 파일을 읽지 못했습니다. 저장소 키를 확인하세요</Callout>}
        <TenantForm disabled={store !== 'OK'} onSuccess={reload} />
      </div>
    </Card>
    {deleting && <TenantDeleteDialog name={deleting.name} busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()} />}
  </section>;
}
