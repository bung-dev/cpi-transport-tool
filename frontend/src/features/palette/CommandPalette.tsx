import { useEffect, useId, useState } from 'react';
import { getPackages, getTemplates } from '../../api/client';
import type { ArtifactSummary, TransportTemplate } from '../../api/types';
import { ROUTES, type Route } from '../../app/routes';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useRemote } from '../../lib/useRemote';
import { useTenants } from '../tenants/TenantContext';
import { templateReason } from '../templates/TemplatesScreen';

export type Command = { type: 'navigate'; route: Route } | { type: 'createTenant' | 'createTemplate' | 'new' | 'route' | 'preview' | 'real' }
  | { type: 'template'; template: TransportTemplate } | { type: 'package'; package: ArtifactSummary }
  | { type: 'source' | 'target'; id: string };
type Item = { id: string; label: string; command: Command; reason?: string };

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const parts = [];
  let offset = 0;
  for (let index = text.toLowerCase().indexOf(query); index >= 0; index = text.toLowerCase().indexOf(query, offset)) {
    parts.push(text.slice(offset, index), <mark key={index} className="rounded-sm bg-caution-bg text-caution-fg">{text.slice(index, index + query.length)}</mark>);
    offset = index + query.length;
  }
  return <>{parts}{text.slice(offset)}</>;
}

export function CommandPalette({ onClose, onCommand, overlaid, previewReason, realReason }: {
  onClose: () => void; onCommand: (command: Command) => void; overlaid: boolean; previewReason?: string; realReason?: string;
}) {
  const { tenants, sourceTenantId, targetTenantId, readOnly } = useTenants();
  const templates = useRemote(getTemplates, 'templates');
  const packages = useRemote(() => sourceTenantId ? getPackages(sourceTenantId) : Promise.resolve([]), sourceTenantId ?? 'none');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const search = query.trim().toLowerCase();
  const list = tenants.state === 'success' ? tenants.data.tenants : [];
  const groups: { name: string; items: Item[] }[] = [
    { name: '화면 이동', items: ROUTES.map(([route, label]) => ({ id: route, label, command: { type: 'navigate', route } })) },
    { name: '동작', items: [
      { id: 'new', label: '새 이관 시작', command: { type: 'new' } },
      { id: 'route', label: '원본·대상 변경', command: { type: 'route' } },
      { id: 'createTenant', label: '테넌트 등록', command: { type: 'createTenant' }, reason: tenants.state !== 'success' || tenants.data.store !== 'OK' ? '테넌트 저장소를 확인하세요' : undefined },
      { id: 'createTemplate', label: '템플릿 만들기', command: { type: 'createTemplate' }, reason: !list.length ? '테넌트를 먼저 등록하세요' : undefined },
      { id: 'preview', label: '미리보기 실행', command: { type: 'preview' }, reason: previewReason },
      { id: 'real', label: '이 구성으로 실제 이관', command: { type: 'real' }, reason: readOnly !== false ? '읽기 전용 상태에서는 실제 이관을 할 수 없습니다' : realReason },
    ] },
    { name: '템플릿', items: templates.state.status === 'ok' ? templates.state.data.map(t => ({ id: `template-${t.id}`, label: t.name, command: { type: 'template', template: t }, reason: !t.usable ? templateReason(t) : undefined })) : [] },
    { name: '테넌트', items: list.flatMap(t => ([
      { id: `source-${t.id}`, label: `${t.name} · 원본으로`, command: { type: 'source', id: t.id }, reason: t.id === targetTenantId ? '원본과 대상은 같을 수 없습니다' : undefined },
      { id: `target-${t.id}`, label: `${t.name} · 대상으로`, command: { type: 'target', id: t.id }, reason: t.id === sourceTenantId ? '원본과 대상은 같을 수 없습니다' : undefined },
    ])) },
    { name: '패키지', items: packages.state.status === 'ok' ? packages.state.data.map(p => ({ id: `package-${p.id}`, label: `${p.name} (${p.id})`, command: { type: 'package', package: p } })) : [] },
  ];
  const filtered = groups.map(g => ({ ...g, items: g.items.filter(i => i.label.toLowerCase().includes(search)) }));
  const items = filtered.flatMap(g => g.items);
  const selected = items[Math.min(active, Math.max(0, items.length - 1))];
  const optionId = (item: Item) => `${id}-${item.id}`;
  useEffect(() => { if (selected) document.getElementById(optionId(selected))?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  function execute(item?: Item) { if (item && !item.reason) onCommand(item.command); }
  return <Modal title="검색 및 명령" palette onClose={onClose}>
    <input role="combobox" aria-label="명령 검색" aria-controls={`${id}-results`} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={selected ? optionId(selected) : undefined}
      className="mb-4 w-full rounded-md border border-control-border bg-canvas p-3" placeholder="화면, 템플릿, 패키지 검색…" value={query}
      onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(n => items.length ? (n + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0); }
        if (e.key === 'Enter') { e.preventDefault(); execute(selected); }
      }} />
    {overlaid && <p className="mb-3 rounded-md bg-warning-bg p-3 text-warning-fg">명령을 실행하면 열린 창이 닫힙니다</p>}
    <div id={`${id}-results`} role="listbox" aria-label="명령 검색 결과" className="max-h-[52dvh] overflow-y-auto">
      {filtered.map(g => <div key={g.name} role="group" aria-label={g.name}>
        <p className="px-2 py-2 text-xs font-semibold text-ink-secondary">{g.name}</p>
        {g.items.map(item => <div key={item.id} id={optionId(item)} role="option" aria-selected={item.id === selected?.id} aria-disabled={Boolean(item.reason)}
          onClick={() => execute(item)} className={`cursor-pointer break-words rounded-md p-3 ${item.id === selected?.id ? 'bg-primary-soft text-primary' : 'hover:bg-surface-hover'} ${item.reason ? 'text-ink-secondary' : ''}`}>
          <Highlight text={item.label} query={search} />{item.reason && <span className="mt-1 block text-xs">{item.reason}</span>}
        </div>)}
        {g.name === '패키지' && packages.state.status === 'error' && <p className="p-2 text-danger-fg">패키지 목록을 불러오지 못했습니다</p>}
        {g.name === '템플릿' && templates.state.status === 'error' && <p className="p-2 text-danger-fg">템플릿 목록을 불러오지 못했습니다</p>}
      </div>)}
    </div>
    {!items.length && <p className="py-5 text-center">일치하는 항목이 없습니다</p>}
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-4"><p className="text-xs text-ink-secondary">↑↓ 이동 · Enter 실행 · Esc 닫기</p><Button onClick={onClose}>닫기</Button></div>
  </Modal>;
}
