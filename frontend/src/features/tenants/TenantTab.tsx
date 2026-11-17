import { useState } from 'react';
import { deleteTenant } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { Tenant } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, Th, Td, Tr } from '../../components/ui/Table';
import { useTenants } from './TenantContext';
import { TenantCheckBadge } from './TenantCheckBadge';
import { TenantForm } from './TenantForm';
import { TenantDeleteDialog } from './TenantDeleteDialog';

export function TenantTab({ initiallyCreate = false }: { initiallyCreate?: boolean }) {
  const { tenants, status, reload } = useTenants();
  const [editing, setEditing] = useState<Tenant | 'new' | null>(initiallyCreate ? 'new' : null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const store = tenants.state === 'success' ? tenants.data.store : undefined;
  async function confirmDelete(deleteTemplates: boolean) {
    if (!deleting || busy) return;
    setBusy(true); setError(undefined);
    try { await deleteTenant(deleting.id, deleteTemplates); setDeleting(null); await reload(); }
    catch (e) { setError(toApiError(e)); }
    finally { setBusy(false); }
  }
  return <section className="grid min-w-0 gap-5">
    <PageHeader title="테넌트" description="이관에 사용할 환경을 등록하고 연결 상태를 확인하세요." actions={<Button variant="primary" disabled={store !== 'OK'} onClick={() => setEditing('new')}>테넌트 등록</Button>} />
    {store === 'NOT_CONFIGURED' && <Callout tone="warning">테넌트 저장소 키(CPI_TENANT_STORE_KEY)가 설정되지 않아 등록할 수 없습니다</Callout>}
    {store === 'UNREADABLE' && <Callout tone="danger">테넌트 저장 파일을 읽지 못했습니다. 저장소 키를 확인하세요</Callout>}
    {tenants.state === 'loading' ? <ListSkeleton /> : tenants.state === 'error' ? <ErrorAlert error={tenants.error} onRetry={() => void reload()} /> :
      tenants.data.tenants.length === 0 ? <p>등록된 테넌트가 없습니다</p> : <Table className="min-w-[560px]">
        <thead><Tr>{['이름', '출처', '연결 상태', '작업'].map(h => <Th key={h}>{h}</Th>)}</Tr></thead>
        <tbody>{tenants.data.tenants.map(t => <Tr key={t.id}>
          <Td>{t.name}</Td><Td>{t.source === 'env' ? '환경 변수' : '등록'}</Td>
          <Td><TenantCheckBadge check={status.state === 'success' ? status.data.tenants.find(s => s.id === t.id)?.check : undefined} failed={status.state === 'error'} /></Td>
          <Td>{t.source === 'registered' && <div className="flex gap-2"><Button size="sm" onClick={() => setEditing(t)}>수정</Button><Button size="sm" onClick={() => { setDeleting(t); setError(undefined); }}>삭제</Button></div>}</Td>
        </Tr>)}</tbody>
      </Table>}
    {editing && store === 'OK' && <Modal drawer title={editing === 'new' ? '테넌트 등록' : '테넌트 수정'} onClose={() => setEditing(null)}>
      <TenantForm tenantId={editing === 'new' ? undefined : editing.id} initialName={editing === 'new' ? '' : editing.name} onCancel={() => setEditing(null)} onSuccess={async () => { setEditing(null); await reload(); }} />
    </Modal>}
    {deleting && <TenantDeleteDialog tenantId={deleting.id} name={deleting.name} busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={value => void confirmDelete(value)} />}
  </section>;
}
