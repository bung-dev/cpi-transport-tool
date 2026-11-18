import { packageSummary } from '../../lib/packageSummary';
import { getHistory } from '../../api/client';
import type { DashboardNode, DashboardQueueItem, TransportTemplate } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { formatTime } from '../../lib/formatTime';
import { useRemote } from '../../lib/useRemote';
import { useTenants } from '../tenants/TenantContext';
import { TenantCheckBadge } from '../tenants/TenantCheckBadge';

export function NodeDrawer({ node, templates, queue, onClose }: {
  node: DashboardNode; templates: TransportTemplate[]; queue: DashboardQueueItem[]; onClose: () => void;
}) {
  const { tenants, status } = useTenants();
  const history = useRemote(getHistory, node.id);
  const tenant = tenants.state === 'success' ? tenants.data.tenants.find(t => t.id === node.id) : undefined;
  const connection = status.state === 'success' ? status.data.tenants.find(t => t.id === node.id) : undefined;
  const usedTemplates = templates.filter(t => t.sourceTenantId === node.id || t.targetTenantId === node.id);
  // 카드의 대기 수는 다음 대상 기준이고, 서랍은 현재 이 노드에 도착해 대기 중인 패키지를 보여준다.
  const waiting = queue.filter(item => item.atTenantId === node.id);
  const recent = history.state.status === 'ok' ? history.state.data
    .filter(item => item.sourceTenant?.id === node.id || item.targetTenant?.id === node.id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 5) : [];
  return <Modal title={tenant?.name ?? node.name} drawer onClose={onClose}>
    <div className="grid min-w-0 gap-6">
      <dl className="grid gap-4 rounded-lg bg-surface p-4">
        <div><dt className="text-sm text-ink-secondary">호스트</dt><dd className="mt-1 break-all">{tenant?.apiHost ?? connection?.apiHost ?? '확인할 수 없습니다'}</dd></div>
        <div><dt className="text-sm text-ink-secondary">출처</dt><dd className="mt-1">{(tenant?.source ?? node.origin) === 'env' ? '환경 변수' : '등록'}</dd></div>
        <div><dt className="mb-1 text-sm text-ink-secondary">마지막 연결 확인</dt><dd><TenantCheckBadge check={connection?.check} failed={status.state === 'error'} /></dd></div>
      </dl>
      <div>
        <h3 className="mb-2 font-semibold">이 노드를 쓰는 템플릿</h3>
        <ul aria-label="이 노드를 쓰는 템플릿" className="grid gap-2">{usedTemplates.map(t => <li className="break-all" key={t.id}>{t.name}</li>)}</ul>
        {usedTemplates.length === 0 && <p className="text-ink-secondary">사용하는 템플릿이 없습니다</p>}
      </div>
      <div>
        <h3 className="mb-2 font-semibold">이 노드의 대기 항목</h3>
        <ul aria-label="이 노드의 대기 항목" className="grid gap-2">{waiting.map(item => <li key={`${item.packageId}:${item.nextTemplateId}`} className="break-all">
          {item.packageId} <span className="text-sm text-ink-secondary">· 아티팩트 {item.artifactCount}개</span>
        </li>)}</ul>
        {waiting.length === 0 && <p className="text-ink-secondary">대기 항목이 없습니다</p>}
      </div>
      <div>
        <h3 className="mb-2 font-semibold">최근 이관</h3>
        {history.state.status === 'loading' && <p role="status">이력을 불러오는 중</p>}
        {history.state.status === 'error' && <ErrorAlert error={history.state.error} onRetry={history.retry} />}
        <ul aria-label="최근 이관" className="grid gap-3">{recent.map(item => <li key={item.transportId} className="min-w-0 rounded-lg border border-hairline p-3">
          <p className="break-all font-medium">{packageSummary(item.packages)}</p>
          <p className="mt-1 break-all text-sm text-ink-secondary">{item.sourceTenant?.name ?? '원본'} → {item.targetTenant?.name ?? '대상'}</p>
          <p className="mt-1 text-xs text-ink-secondary">{formatTime(item.startedAt)} · {item.dryRun ? '미리보기' : '실제 이관'}</p>
        </li>)}</ul>
        {history.state.status === 'ok' && recent.length === 0 && <p className="text-ink-secondary">이관 이력이 없습니다</p>}
      </div>
      <Button onClick={onClose}>닫기</Button>
    </div>
  </Modal>;
}
