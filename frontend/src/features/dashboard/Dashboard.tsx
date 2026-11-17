import { useState } from 'react';
import { getDashboard, getTemplates } from '../../api/client';
import type { DashboardNode, TransportTemplate } from '../../api/types';
import { navigate } from '../../app/routes';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { BrandIcon, InboxIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';
import { useRemote } from '../../lib/useRemote';
import { useTenants } from '../tenants/TenantContext';
import { TenantCheckBadge } from '../tenants/TenantCheckBadge';
import { hasNoTenants, REGISTER_TENANT_FIRST } from '../transport/noTenants';
import { NodeDrawer } from './NodeDrawer';
import { orderLandscape } from './landscape';

export function Dashboard({ onForward }: { onForward: (template: TransportTemplate, packageId: string) => void }) {
  const [templateId, setTemplateId] = useState('');
  const [selected, setSelected] = useState<DashboardNode | null>(null);
  const dashboard = useRemote(() => getDashboard(templateId), templateId);
  const templates = useRemote(getTemplates, 'templates');
  const { tenants, status, reload } = useTenants();
  const data = dashboard.state.status === 'ok' ? dashboard.state.data : null;
  const templateList = templates.state.status === 'ok' ? templates.state.data : [];
  const tenantList = tenants.state === 'success' ? tenants.data.tenants : [];
  const store = tenants.state === 'success' ? tenants.data.store : undefined;
  const tenantName = (id: string) => tenantList.find(t => t.id === id)?.name ?? data?.nodes.find(n => n.id === id)?.name ?? id;
  const templateName = (id: string) => templateList.find(t => t.id === id)?.name ?? id;
  const landscape = data ? orderLandscape(data.nodes, data.edges) : null;

  function nodeCard(node: DashboardNode) {
    const check = status.state === 'success' ? status.data.tenants.find(t => t.id === node.id)?.check : undefined;
    const waiting = data!.queue.filter(item => item.nextTargetTenantId === node.id).length;
    return <li key={node.id} className="min-w-0">
      <button type="button" onClick={() => setSelected(node)} aria-haspopup="dialog"
        className="flex h-full w-full cursor-pointer flex-col gap-4 rounded-xl border border-hairline-strong bg-canvas p-5 text-left shadow-xs transition-colors hover:border-primary hover:bg-primary-soft">
        <span className="flex w-full min-w-0 items-start justify-between gap-3">
          <span className="break-all text-xl font-semibold">{tenantName(node.id)}</span>
          <span aria-hidden="true" className="rounded-md bg-primary-soft p-2 text-primary"><BrandIcon /></span>
        </span>
        <TenantCheckBadge check={check} failed={status.state === 'error' || check !== undefined && check !== 'OK'} />
        <span className="mt-auto flex w-full flex-wrap justify-between gap-2 border-t border-hairline pt-3 text-xs">
          <span className="font-medium text-primary">대기 {waiting}건</span>
          <span className="text-ink-secondary">노드 상세 ↗</span>
        </span>
      </button>
    </li>;
  }

  // 테넌트 목록을 읽었고 0개면 첫 화면은 시작 안내만 보인다. 빈 요약·경로·대기 항목은 그리지 않는다.
  if (hasNoTenants(tenants)) return <div className="grid min-w-0 gap-5">
    <PageHeader title="대시보드" description="환경 사이의 경로를 살펴보고, 다음 이관을 준비하세요." />
    <section aria-label="시작하기" className="min-w-0 rounded-xl border border-hairline bg-canvas p-6">
      <h3 className="mb-2 text-lg font-semibold">시작하기</h3>
      <p className="mb-5 text-ink-secondary">CPI 테넌트를 등록하면 한 테넌트의 패키지를 다른 테넌트로 옮길 수 있습니다.</p>
      <ol className="mb-6 grid gap-4 sm:grid-cols-3">
        {([
          ['테넌트 등록', '원본과 대상 테넌트를 각각 서비스 키(JSON)로 등록합니다.'],
          ['미리보기', '새 이관에서 원본·대상과 패키지를 고르고, 대상에 쓰지 않고 결과를 먼저 확인합니다.'],
          ['실제 이관', '미리보기를 확인한 뒤 대상 테넌트로 옮깁니다.'],
        ] as const).map(([title, text], i) => <li key={title} className="flex min-w-0 gap-3 rounded-lg bg-surface p-4">
          <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{i + 1}</span>
          <span className="min-w-0"><strong className="block font-semibold">{title}</strong><span className="mt-1 block text-sm text-ink-secondary">{text}</span></span>
        </li>)}
      </ol>
      {/* 저장소를 쓸 수 없으면 등록 버튼이 막혀 있으므로, 등록하라는 대신 이유를 보인다(문구는 테넌트 화면과 같다). */}
      {store === 'NOT_CONFIGURED' ? <p className="mb-3">테넌트 저장소 키(CPI_TENANT_STORE_KEY)가 설정되지 않아 등록할 수 없습니다</p>
        : store === 'UNREADABLE' ? <p className="mb-3">테넌트 저장 파일을 읽지 못했습니다. 저장소 키를 확인하세요</p>
        : <p className="mb-3">{REGISTER_TENANT_FIRST}</p>}
      <Button onClick={() => navigate('tenants')}>테넌트 화면으로 이동</Button>
    </section>
  </div>;

  return <div className="grid min-w-0 gap-5">
    <PageHeader title="대시보드" description="환경 사이의 경로를 살펴보고, 다음 이관을 준비하세요." />
    {tenants.state === 'error' && <ErrorAlert error={tenants.error} onRetry={() => { void reload(); }} />}
    {templates.state.status === 'error' && <ErrorAlert error={templates.state.error} onRetry={templates.retry} />}
    {templates.state.status === 'ok' && templateList.length === 0 && <div className="rounded-xl border border-hairline bg-canvas p-6">
      <p className="mb-3">템플릿을 만들면 경로와 대기 항목이 보입니다</p>
      <Button onClick={() => navigate('templates')}>템플릿 만들기</Button>
    </div>}
    {dashboard.state.status === 'loading' && <p role="status">대시보드를 불러오는 중</p>}
    {dashboard.state.status === 'error' && <ErrorAlert error={dashboard.state.error} onRetry={dashboard.retry} />}
    {data && landscape && <>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-primary p-6 text-on-primary">
          <div><p className="text-xl font-semibold leading-relaxed">검증한 구성을,<br />다음 환경으로.</p><p className="mt-3 text-sm">미리보기로 확인하고 한 단계씩 이동합니다.</p></div>
          <BrandIcon className="h-8 w-8" />
        </div>
        <section aria-label="오늘 요약" className="min-w-0 rounded-xl border border-hairline bg-canvas p-6 lg:col-span-2">
          <h3 className="mb-5 font-semibold">오늘 요약</h3>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            {([
              ['미리보기', data.today.previews], ['실제 이관', data.today.transports],
              ['성공', data.today.succeeded], ['실패', data.today.failed],
            ] as const).map(([label, count]) => <div key={label}>
              <span className="block text-sm text-ink-secondary">{label} </span>
              <strong className={`text-3xl font-semibold ${label === '실패' && count > 0 ? 'text-danger-fg' : 'text-primary'}`}>{count}</strong>
            </div>)}
          </div>
        </section>
      </div>
      <section aria-label="이관 경로" className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-canvas">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline p-5">
          <h3 className="text-lg font-semibold">이관 경로</h3>
          <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">템플릿별 보기
            <select value={templateId} onChange={e => { setSelected(null); setTemplateId(e.target.value); }}
              className="max-w-full min-w-0 rounded-md border border-control-border bg-canvas px-3 py-2">
              <option value="">모든 템플릿</option>
              {templateList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-6 bg-surface p-5 sm:p-8">
          <ul aria-label="경로의 테넌트" className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3">{landscape.flow.map(nodeCard)}</ul>
          <ul aria-label="템플릿 경로" className="flex min-w-0 flex-wrap gap-3">
            {data.edges.map(edge => <li key={`${edge.sourceTenantId}:${edge.targetTenantId}`}
              className="min-w-0 rounded-lg border border-hairline bg-primary-soft px-4 py-3">
              <p className="break-all font-medium text-primary">{tenantName(edge.sourceTenantId)} → {tenantName(edge.targetTenantId)}</p>
              <p className="mt-1 break-all text-xs text-ink-secondary">{edge.templateIds.map(templateName).join(' · ')}</p>
            </li>)}
          </ul>
          {!templateId && landscape.loose.length > 0 && <div className="border-t border-hairline pt-5">
            <h4 className="mb-3 text-sm text-ink-secondary">경로 없는 테넌트</h4>
            <ul aria-label="경로 없는 테넌트" className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3">{landscape.loose.map(nodeCard)}</ul>
          </div>}
        </div>
      </section>
      <section aria-label="대기 항목" className="min-w-0 rounded-xl border border-hairline bg-canvas">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline p-5">
          <h3 className="text-lg font-semibold">대기 항목 <span className="ml-2 text-sm text-ink-secondary">{data.queue.length}건</span></h3>
          <p className="text-sm text-ink-secondary">다음 환경으로 전달</p>
        </div>
        {data.queue.length === 0 ? <p className="p-8 text-center text-ink-secondary">대기 항목이 없습니다</p> :
          <ul className="divide-y divide-hairline">{data.queue.map(item => {
            const template = templateList.find(t => t.id === item.nextTemplateId);
            return <li key={`${item.packageId}:${item.atTenantId}:${item.nextTemplateId}`} className="flex min-w-0 flex-wrap items-center gap-4 p-5">
              <span aria-hidden="true" className="rounded-lg bg-primary-soft p-3 text-primary"><InboxIcon /></span>
              <div className="min-w-0 flex-1 basis-44">
                <h4 className="break-all font-semibold">{item.packageId}</h4>
                <p className="mt-1 break-all text-sm text-ink-secondary">{tenantName(item.atTenantId)} → {tenantName(item.nextTargetTenantId)}</p>
                <p className="mt-1 break-all text-xs text-ink-secondary">{templateName(item.nextTemplateId)} · 아티팩트 {item.artifactCount}개</p>
              </div>
              <Button disabled={!template?.usable} onClick={() => { if (template?.usable) onForward(template, item.packageId); }}>전달</Button>
            </li>;
          })}</ul>}
      </section>
      {selected && <NodeDrawer key={selected.id} node={selected} templates={templateList} queue={data.queue} onClose={() => setSelected(null)} />}
    </>}
  </div>;
}
