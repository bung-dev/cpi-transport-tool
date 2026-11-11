import { useId, useState } from 'react';
import { deleteTemplate, getPackages, getTemplates, saveTemplate } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { TransportTemplate } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, Th, Tr, Td } from '../../components/ui/Table';
import { TextInput } from '../../components/ui/TextInput';
import { useRemote } from '../../lib/useRemote';
import { useTenants } from '../tenants/TenantContext';
import { navigate } from '../../app/routes';

export function templateReason(t: TransportTemplate) {
  return t.usable ? '사용 가능' : t.unusableReason === 'SOURCE_TENANT_MISSING' ? '원본 테넌트가 삭제됨' : '대상 테넌트가 삭제됨';
}
export function TemplatesScreen({ initiallyCreate = false, onUse }: { initiallyCreate?: boolean; onUse: (t: TransportTemplate) => void }) {
  const { tenants } = useTenants();
  const { state, retry } = useRemote(getTemplates, 'templates');
  const [editing, setEditing] = useState<TransportTemplate | 'new' | null>(initiallyCreate ? 'new' : null);
  const [deleting, setDeleting] = useState<TransportTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const list = tenants.state === 'success' ? tenants.data.tenants : [];
  const empty = tenants.state === 'success' && !list.length;
  const name = (id: string) => list.find(t => t.id === id)?.name ?? id;
  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true); setError(undefined);
    try { await deleteTemplate(deleting.id); setDeleting(null); retry(); }
    catch (e) { setError(toApiError(e)); }
    finally { setBusy(false); }
  }
  return <section className="grid min-w-0 gap-5">
    <PageHeader title="템플릿" description="자주 사용하는 경로와 패키지를 저장해 이관을 준비하세요." actions={<Button variant="primary" disabled={!list.length} onClick={() => setEditing('new')}>템플릿 만들기</Button>} />
    {empty && <div className="grid justify-items-start gap-3"><p>테넌트를 먼저 등록해야 템플릿을 만들 수 있습니다</p><Button onClick={() => navigate('tenants')}>테넌트 화면으로 이동</Button></div>}
    {state.status === 'loading' && <p role="status">불러오는 중</p>}
    {state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
    {state.status === 'ok' && (state.data.length ? <Table className="min-w-[740px]">
      <thead><Tr>{['이름', '경로', '패키지', '상태', '작업'].map(h => <Th key={h}>{h}</Th>)}</Tr></thead>
      <tbody>{state.data.map(t => <Tr key={t.id}><Td>{t.name}</Td><Td>{name(t.sourceTenantId)} → {name(t.targetTenantId)}</Td><Td>{t.packageId || '실행 때 선택'}</Td>
        <Td><span className={t.usable ? 'text-success-fg' : 'text-danger-fg'}>{templateReason(t)}</span></Td>
        <Td><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!t.usable} onClick={() => onUse(t)}>이 템플릿으로 이관</Button><Button size="sm" onClick={() => setEditing(t)}>수정</Button><Button size="sm" onClick={() => { setDeleting(t); setError(undefined); }}>삭제</Button></div></Td>
      </Tr>)}</tbody>
    </Table> : <p className="rounded-xl border border-hairline bg-canvas p-10 text-center text-ink-secondary">저장된 템플릿이 없습니다</p>)}
    {editing && (editing !== 'new' || list.length > 0) && <Modal drawer title={editing === 'new' ? '템플릿 만들기' : '템플릿 수정'} onClose={() => setEditing(null)}>
      <TemplateForm template={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); retry(); }} />
    </Modal>}
    {deleting && <Modal title="템플릿 삭제 확인" busy={busy} onClose={() => setDeleting(null)}>
      <p className="break-all">{deleting.name} 템플릿을 삭제합니다.</p>
      {error && <ErrorAlert error={error} />}
      <div className="mt-5 flex justify-end gap-2"><Button disabled={busy} onClick={() => setDeleting(null)}>취소</Button><Button variant="primary" disabled={busy} onClick={() => void confirmDelete()}>삭제</Button></div>
    </Modal>}
  </section>;
}

function TemplateForm({ template, onCancel, onSaved }: { template?: TransportTemplate; onCancel: () => void; onSaved: () => void }) {
  const id = useId();
  const { tenants } = useTenants();
  const list = tenants.state === 'success' ? tenants.data.tenants : [];
  const [name, setName] = useState(template?.name ?? '');
  const [source, setSource] = useState(template?.sourceTenantId ?? list[0]?.id ?? '');
  const [target, setTarget] = useState(template?.targetTenantId ?? list[1]?.id ?? '');
  const [pkg, setPkg] = useState(template?.packageId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const packages = useRemote(() => source && list.some(t => t.id === source) ? getPackages(source) : Promise.resolve([]), source);
  const same = source === target;
  const valid = name.trim() && !same && list.some(t => t.id === source) && list.some(t => t.id === target);
  return <form className="grid gap-4" onSubmit={async e => {
    e.preventDefault(); if (!valid || busy) return;
    setBusy(true); setError(undefined);
    try { await saveTemplate({ name: name.trim(), sourceTenantId: source, targetTenantId: target, packageId: pkg || null }, template?.id); onSaved(); }
    catch (err) { setError(toApiError(err)); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy} className="grid min-w-0 gap-4">
      <TextInput label="이름" required maxLength={60} value={name} onChange={e => setName(e.target.value)} />
      {(['원본', '대상'] as const).map(label => <div key={label} className="grid gap-2"><label htmlFor={`${id}-${label}`}>{label}</label>
        <select id={`${id}-${label}`} className="rounded-md border border-control-border bg-canvas p-2" value={label === '원본' ? source : target} onChange={e => {
          if (label === '원본') { setSource(e.target.value); setPkg(''); } else setTarget(e.target.value);
        }}>
          <option value="">선택하세요</option>
          {![...list.map(t => t.id), ''].includes(label === '원본' ? source : target) && <option value={label === '원본' ? source : target}>{label === '원본' ? source : target} (삭제됨)</option>}
          {list.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>)}
      {same && <p className="text-warning-fg">원본과 대상이 같습니다</p>}
      <div className="grid gap-2"><label htmlFor={`${id}-package`}>패키지</label><select id={`${id}-package`} className="min-w-0 rounded-md border border-control-border bg-canvas p-2" value={pkg} onChange={e => setPkg(e.target.value)}>
        <option value="">실행 때 선택</option>
        {pkg && (packages.state.status !== 'ok' || !packages.state.data.some(p => p.id === pkg)) && <option value={pkg}>{pkg}</option>}
        {packages.state.status === 'ok' && packages.state.data.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
      </select></div>
      <div className="flex gap-2"><Button type="submit" variant="primary" disabled={!valid || busy}>저장</Button><Button onClick={onCancel}>취소</Button></div>
    </fieldset>
    {packages.state.status === 'error' && <ErrorAlert error={packages.state.error} onRetry={packages.retry} />}
    {error && <ErrorAlert error={error} />}
  </form>;
}
