import { useState } from 'react';
import { getTemplates } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorAlert } from '../../components/ErrorAlert';
import type { ApiError } from '../../api/errors';
import { useRemote } from '../../lib/useRemote';

export function TenantDeleteDialog({ tenantId, name, busy, error, onCancel, onConfirm }: {
  tenantId?: string; name: string; busy: boolean; error?: ApiError; onCancel: () => void; onConfirm: (deleteTemplates: boolean) => void;
}) {
  const { state, retry } = useRemote(getTemplates, 'templates');
  const [cascade, setCascade] = useState(false);
  const templates = state.status === 'ok' ? state.data.filter(t => t.sourceTenantId === tenantId || t.targetTenantId === tenantId) : [];
  return <Modal title="테넌트 삭제 확인" busy={busy} onClose={onCancel}>
    <p className="break-all">{name}의 앱 등록을 삭제합니다.</p>
    {state.status === 'loading' && <p role="status">사용 중인 템플릿 확인 중</p>}
    {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
    {templates.length > 0 && <div className="mt-4 grid gap-3">
      <p>이 테넌트를 사용하는 템플릿</p><ul className="list-inside list-disc">{templates.map(t => <li key={t.id}>{t.name}</li>)}</ul>
      <label className="flex gap-2"><input type="checkbox" checked={cascade} disabled={busy} onChange={e => setCascade(e.target.checked)} />템플릿 {templates.length}개도 함께 삭제</label>
    </div>}
    {error && <ErrorAlert error={error} />}
    <div className="mt-5 flex justify-end gap-2"><Button disabled={busy} onClick={onCancel}>취소</Button><Button variant="primary" disabled={busy || state.status === 'loading'} onClick={() => onConfirm(state.status === 'ok' && templates.length > 0 && cascade)}>삭제</Button></div>
    {busy && <p role="status">삭제 중</p>}
  </Modal>;
}
