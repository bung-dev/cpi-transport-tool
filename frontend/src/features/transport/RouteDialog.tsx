import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { RadioControl } from '../../components/ui/Radio';
import { TenantCheckBadge } from '../tenants/TenantCheckBadge';
import { useTenants } from '../tenants/TenantContext';

interface Props {
  onApply: (source: string, target: string) => void;
  onClose: () => void;
}

// REQ-420: 원본·대상 선택 창. 라디오의 이름은 테넌트 이름만이고 연결 상태는 설명(aria-describedby)이다. 호스트는 보이지 않는다.
export function RouteDialog({ onApply, onClose }: Props) {
  const base = useId();
  const { tenants, status, sourceTenantId, targetTenantId } = useTenants();
  const [source, setSource] = useState(sourceTenantId);
  const [target, setTarget] = useState(targetTenantId);
  const list = tenants.state === 'success' ? tenants.data.tenants : [];
  const same = source !== null && source === target;
  const valid = !same && list.some(t => t.id === source) && list.some(t => t.id === target);
  const check = (id: string) => (status.state === 'success' ? status.data.tenants.find(t => t.id === id)?.check : undefined);
  const groups = [
    { key: 'source', title: '원본', value: source, select: setSource },
    { key: 'target', title: '대상', value: target, select: setTarget },
  ];
  return (
    <Modal title="원본과 대상 선택" onClose={onClose}>
      <div className="grid min-w-0 gap-4">
        {list.length === 0 && <p className="text-ink-secondary">등록된 테넌트가 없습니다</p>}
        {list.length > 0 && groups.map(group => {
          const legendId = `${base}-${group.key}-legend`;
          return (
            <fieldset key={group.key} role="radiogroup" aria-labelledby={legendId} className="min-w-0">
              <legend id={legendId} className="mb-1.5 text-xs font-medium text-ink-tertiary">{group.title}</legend>
              <div className="flex min-w-0 flex-col gap-1">
                {list.map((tenant, i) => {
                  const titleId = `${base}-${group.key}-${i}-title`;
                  const descId = `${base}-${group.key}-${i}-desc`;
                  return (
                    <label key={tenant.id} className={`flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${group.value === tenant.id ? 'bg-primary-soft' : 'hover:bg-surface-hover'}`}>
                      <RadioControl name={`${base}-${group.key}`} value={tenant.id} checked={group.value === tenant.id}
                        onChange={() => group.select(tenant.id)} aria-labelledby={titleId} aria-describedby={descId} />
                      <span id={titleId} className="min-w-0 flex-1 font-medium break-all">{tenant.name}</span>
                      <span id={descId} className="shrink-0">
                        <TenantCheckBadge check={check(tenant.id)} failed={status.state === 'error'} />
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        {same && <p role="alert" className="rounded-md bg-warning-bg px-3 py-2.5 text-warning-fg">원본과 대상이 같습니다. 서로 다른 테넌트를 고르세요</p>}
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onClose}>취소</Button>
        <Button variant="primary" disabled={!valid} onClick={() => { if (valid && source && target) onApply(source, target); }}>이 경로 사용</Button>
      </div>
    </Modal>
  );
}
