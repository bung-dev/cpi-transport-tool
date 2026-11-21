import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { getPackages, getTemplates } from '../../api/client';
import type { ArtifactSummary, ArtifactType, TransportTemplate } from '../../api/types';
import { navigate } from '../../app/routes';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { PageHeader } from '../../components/ui/PageHeader';
import { CheckboxControl } from '../../components/ui/Checkbox';
import { packageSummary } from '../../lib/packageSummary';
import { TextInput } from '../../components/ui/TextInput';
import { useRemote } from '../../lib/useRemote';
import { TransportResult } from '../result/TransportResult';
import { ActiveJobNotice } from '../job/ActiveJobBanner';
import { templateReason } from '../templates/TemplatesScreen';
import { useReadOnlyState, useTenants } from '../tenants/TenantContext';
import { ArtifactGrid } from './ArtifactGrid';
import { ConfirmDialog } from './ConfirmDialog';
import { PreviewProgress } from './PreviewProgress';
import { REGISTER_TENANT_FIRST, hasNoTenants } from './noTenants';
import { RouteDialog } from './RouteDialog';
import { ARTIFACT_TYPES, artifactCounts, TOO_MANY_ARTIFACTS, type Wizard, type WizardStep } from './useWizard';

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 'template', label: '템플릿' },
  { step: 'package', label: '패키지' },
  { step: 'artifacts', label: '아티팩트' },
  { step: 'preview', label: '미리보기' },
  { step: 'real', label: '실제 이관' },
];

// REQ-420~423: 새 이관 마법사. 상태는 App이 들고 있는 useWizard 하나이고(팔레트 명령이 같은 상태를 쓴다), 이 컴포넌트는 그리기만 한다.
export function TransportWizard({ wizard: w }: { wizard: Wizard }) {
  const realButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="min-w-0">
      <PageHeader title="새 이관" description={`${w.routeText} · 미리보기로 변경 내용을 먼저 확인한 뒤 실제 이관합니다.`} />
      <div className="flex min-w-0 flex-col gap-4">
        <StepBar w={w} />
        <div role="group" aria-label="이관 경로" className="flex min-w-0 flex-wrap items-center gap-3 rounded-md bg-surface px-3 py-2">
          <span className="min-w-0 break-all font-medium">{w.routeText}</span>
          <Button size="sm" className="ml-auto" onClick={w.openRouteDialog}>경로 변경</Button>
        </div>
        {w.step === 'template' && <TemplateStep w={w} />}
        {w.step === 'package' && <PackageStep w={w} />}
        {w.step === 'artifacts' && <ArtifactStep w={w} />}
        {w.step === 'preview' && <PreviewStep w={w} />}
        {w.step === 'real' && <RealStep w={w} buttonRef={realButton} />}
      </div>
      {w.routeDialog && <RouteDialog onApply={w.changeRoute} onClose={w.closeRouteDialog} />}
      {w.confirm && !w.realDisabled && w.preview && w.route.target && (
        <ConfirmDialog
          previewId={w.preview.transportId}
          targetName={w.targetName}
          routeText={w.routeText}
          packages={w.preview.packages.map(p => ({ ...p, packageName: p.packageName ?? w.packages.find(selected => selected.id === p.packageId)?.name ?? null }))}
          targetTenantId={w.route.target}
          artifactCount={w.preview.summary.total}
          deploy={w.confirm.deploy}
          onDeployChange={w.setConfirmDeploy}
          busy={w.busy}
          activeJobId={w.confirm.conflictJobId ?? w.activeJobId}
          onConfirm={w.confirmReal}
          onCancel={w.cancelConfirm}
          fallbackFocusRef={realButton}
        />
      )}
    </div>
  );
}

function StepBar({ w }: { w: Wizard }) {
  const summary: Record<WizardStep, string | null> = {
    template: w.template ? w.template.name : w.templateDone ? '템플릿 없음' : null,
    package: w.packages.length ? packageSummary(w.packages.map(p => ({ packageId: p.id, packageName: p.name }))) : null,
    artifacts: w.artifactSummary,
    preview: null,
    real: null,
  };
  return (
    <nav aria-label="이관 단계" className="min-w-0 overflow-x-auto">
      <ol className="flex min-w-0 gap-1.5">
        {STEPS.map(({ step, label }, i) => {
          const current = w.step === step;
          return (
            <li key={step} className="min-w-0 flex-1">
              <button type="button" aria-current={current ? 'step' : undefined} disabled={!w.canGo(step)} onClick={() => w.goStep(step)}
                className={`flex h-full w-full min-w-[96px] cursor-pointer flex-col items-start rounded-md border px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:text-ink-disabled ${current ? 'border-primary bg-primary-soft text-primary' : 'border-hairline bg-canvas enabled:hover:bg-surface-hover'}`}>
                <span className="text-xs font-medium">{`${i + 1}. ${label}`}</span>
                {summary[step] !== null && <span className="max-w-full truncate text-xs text-ink-secondary">{summary[step]}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 요청 중 표시, 요청 오류, 템플릿 오류 뒤 "템플릿 없이 다시 실행"(실행 영역, ADR-016) */
function RunStatus({ w }: { w: Wizard }) {
  return (
    <>
      {w.busy && !w.previewJob && !w.confirm && <p role="status" className="text-sm text-ink-secondary">이관 실행 중</p>}
      {w.error && <ErrorAlert error={w.error} />}
      {w.templateFailure && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">템플릿이 바뀌었거나 삭제되었습니다</p>
          <Button onClick={w.retryWithoutTemplate}>템플릿 없이 다시 실행</Button>
        </div>
      )}
    </>
  );
}

function TemplateStep({ w }: { w: Wizard }) {
  const { tenants } = useTenants();
  const { state, retry } = useRemote(getTemplates, 'templates');
  const base = useId();
  // 테넌트 목록을 읽는 중이면 기다린다(경로 이름을 보이고, 처음 읽은 기본 경로가 템플릿 경로를 덮지 않게).
  const waiting = state.status === 'loading' || tenants.state === 'loading';
  return (
    <Card title="템플릿 선택" actions={<Button variant="primary" onClick={w.startManual}>템플릿 없이 진행</Button>}>
      {waiting && <ListSkeleton />}
      {!waiting && state.status === 'error' && <ErrorAlert error={state.error} onRetry={retry} />}
      {!waiting && state.status === 'ok' && (state.data.length === 0
        ? <EmptyState title="저장된 템플릿이 없습니다" />
        : (
          <ul aria-label="템플릿 목록" className="grid min-w-0 gap-2 sm:grid-cols-2">
            {state.data.map((t: TransportTemplate) => {
              const nameId = `${base}-${t.id}`;
              return (
                <li key={t.id} aria-labelledby={nameId} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-hairline p-3">
                  <p id={nameId} className="font-medium break-all">{t.name}</p>
                  <p className="text-sm break-all">{`${w.tenantName(t.sourceTenantId)} → ${w.tenantName(t.targetTenantId)}`}</p>
                  {!t.usable && <p className="text-sm text-danger-fg">{templateReason(t)}</p>}
                  <div className="mt-1">
                    <Button size="sm" disabled={!t.usable} onClick={() => w.applyTemplate(t)}>이 템플릿으로 시작</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </Card>
  );
}

function PackageStep({ w }: { w: Wizard }) {
  const { tenants, sourceTenantId, reload } = useTenants();
  let body: ReactNode;
  if (tenants.state === 'loading') body = <ListSkeleton />;
  else if (tenants.state === 'error') body = <ErrorAlert error={tenants.error} onRetry={() => void reload()} />;
  else if (hasNoTenants(tenants)) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p>{REGISTER_TENANT_FIRST}</p>
        <Button onClick={() => navigate('tenants')}>테넌트 화면으로 이동</Button>
      </div>
    );
  } else if (!sourceTenantId) body = <EmptyState title="원본 테넌트를 선택하세요" />;
  else body = <PackageList key={sourceTenantId} w={w} source={sourceTenantId} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card title="패키지">{body}</Card>
      <RunStatus w={w} />
    </div>
  );
}

// 행 전체를 label로 감싸 어디를 눌러도 선택된다. 선택된 행은 primary-soft.
const ROW_BASE = 'flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors duration-150';

function PackageList({ w, source }: { w: Wizard; source: string }) {
  const { state, retry } = useRemote(() => getPackages(source), 'packages:' + source);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (state.status === 'ok') w.setPackageOrder(state.data);
  }, [state]);

  if (state.status === 'loading') return <ListSkeleton />;
  if (state.status === 'error') return <ErrorAlert error={state.error} onRetry={retry} />;
  // 정규식이 아니라 includes로 비교한다: ( [ 같은 입력도 글자 그대로 취급된다.
  const q = query.toLowerCase();
  const shown = state.data.filter(p => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  const selectedIds = new Set(w.packages.map(p => p.id));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{`${w.packages.length}개 선택`}</span>
        <Button size="sm" disabled={shown.length === 0} onClick={() => w.addPackages(shown)}>전체 선택</Button>
        <Button size="sm" onClick={w.clearPackages}>선택 해제</Button>
      </div>
      {state.data.length === 0 ? <EmptyState title="패키지가 없습니다" /> : (
        <div className="flex min-w-0 flex-col">
          <TextInput label="패키지 검색" hideLabel icon={<SearchIcon />} placeholder="이름 또는 ID로 검색" value={query} onChange={e => setQuery(e.target.value)} />
          <p className="mt-2.5 mb-1.5 px-0.5 text-xs text-ink-tertiary">{`${shown.length} / ${state.data.length}개`}</p>
          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2">
              <EmptyState title="검색 결과가 없습니다" />
              <Button size="sm" onClick={() => setQuery('')}>검색어 지우기</Button>
            </div>
          ) : (
            <ul className="flex max-h-[360px] min-w-0 flex-col gap-0.5 overflow-y-auto" aria-label="패키지 목록">
              {shown.map((p: ArtifactSummary) => (
                <li key={p.id} className="min-w-0">
                  <label className={`${ROW_BASE} ${selectedIds.has(p.id) ? 'bg-primary-soft' : 'hover:bg-surface-hover'}`}>
                    <CheckboxControl checked={selectedIds.has(p.id)} onChange={() => w.selectPackage(p)} />
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium break-all">{p.name}</span>{' '}
                      <span className="font-mono text-[13px] text-ink-secondary break-all">{p.id}</span>
                    </span>{' '}
                    <span className="ml-auto shrink-0 text-xs text-ink-tertiary">{p.version}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={w.allPreviewReason !== undefined} onClick={() => w.runPreview({ allArtifacts: true })}>
          전체 아티팩트로 미리보기
        </Button>
        <Button variant="primary" disabled={!w.packages.length} onClick={() => w.goStep('artifacts')}>다음</Button>
      </div>
    </div>
  );
}

function ArtifactStep({ w }: { w: Wizard }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => w.selectAllArtifacts(true)}>모두 선택</Button>
        <Button onClick={() => w.selectAllArtifacts(false)}>모두 해제</Button>
      </div>
      {w.packages.length ? w.packages.map(pkg => <ArtifactList key={pkg.id} w={w} pkg={pkg} />)
        : <Card title="아티팩트"><EmptyState title="패키지를 먼저 선택하세요" /></Card>}
      {w.tooMany && <p className="text-sm text-danger-fg">{`${TOO_MANY_ARTIFACTS}. 선택을 줄이세요`}</p>}
      {w.noneSelected && <p className="text-sm text-ink-secondary">아티팩트를 하나 이상 선택하세요</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => w.goStep('package')}>이전</Button>
        <Button variant="primary" disabled={w.previewReason !== undefined} onClick={() => w.runPreview()}>미리보기 실행</Button>
      </div>
      <RunStatus w={w} />
    </div>
  );
}

function ArtifactList({ w, pkg }: { w: Wizard; pkg: ArtifactSummary }) {
  const titleId = useId();
  const lists = w.artifacts[pkg.id];
  const { total, selected } = artifactCounts(lists);
  const empty = total === 0 && ARTIFACT_TYPES.every(type => lists?.[type]?.status === 'ok');
  return (
    <Card role="region" aria-labelledby={titleId}
      title={<span id={titleId} className="break-all">{pkg.name} <span className="font-mono break-all">{pkg.id}</span></span>}
      meta={lists?.INTEGRATION_FLOW?.status === 'error' && !total ? undefined : `${selected}개 선택 / 전체 ${total}개`}
    >
      {empty && <EmptyState title="아티팩트가 없습니다" />}
      <div className="flex min-w-0 flex-col gap-4">
        {ARTIFACT_TYPES.map(type => <ArtifactGroup key={type} w={w} packageId={pkg.id} type={type} />)}
      </div>
    </Card>
  );
}

const TYPE_LABELS: Record<ArtifactType, string> = {
  INTEGRATION_FLOW: 'iFlow', SCRIPT_COLLECTION: '스크립트 컬렉션', MESSAGE_MAPPING: '메시지 매핑', VALUE_MAPPING: '밸류 매핑',
};

function ArtifactGroup({ w, packageId, type }: { w: Wizard; packageId: string; type: ArtifactType }) {
  const titleId = useId();
  const state = w.artifacts[packageId]?.[type];
  const retry = () => void w.loadArtifacts(packageId, type, true);
  const select = (ids: string[]) => w.setArtifactIds(packageId, type, ids);
  const hasItems = state?.status === 'ok' && state.items.length > 0;
  return (
    <div role="group" aria-labelledby={titleId} className="min-w-0 border-t border-hairline pt-3">
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
        <h4 id={titleId} className="text-sm font-semibold">{TYPE_LABELS[type]}</h4>
        {hasItems && <>
          <span className="text-xs text-ink-tertiary">{`선택 ${state.selected.length}/${state.items.length}`}</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => select(state.items.map(a => a.id))}>전체 선택</Button>
            <Button size="sm" onClick={() => select([])}>선택 해제</Button>
          </div>
        </>}
      </div>
      {(!state || state.status === 'loading') && <ListSkeleton />}
      {state?.status === 'error' && (type === 'INTEGRATION_FLOW'
        ? <ErrorAlert error={state.error} onRetry={retry} />
        : <Callout tone="danger" role="alert" title="목록을 읽지 못했습니다">
            <Button size="sm" onClick={retry}>다시 읽기</Button>
          </Callout>)}
      {state?.status === 'ok' && (hasItems
        ? <div className="max-h-[420px] min-w-0 overflow-y-auto">
            <ArtifactGrid artifacts={state.items} selectedIds={state.selected} onChange={select} />
          </div>
        : <p className="text-sm text-ink-secondary">없음</p>)}
    </div>
  );
}

function PreviewStep({ w }: { w: Wizard }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!w.preview && <div className="flex justify-end">
        <Button variant="primary" disabled={w.previewReason !== undefined} onClick={() => w.runPreview()}>미리보기 실행</Button>
      </div>}
      {w.previewJob && (w.previewJob.pollFailed
        ? <ErrorAlert error={{ title: '진행 상황을 불러오지 못했습니다' }} onRetry={w.retryPreviewPoll} />
        : <PreviewProgress job={w.previewJob} artifacts={w.artifacts} onCancel={w.cancelPreview} />)}
      {w.previewCancelled && <p role="status" className="text-sm text-ink-secondary">미리보기를 취소했습니다</p>}
      {w.preview && <TransportResult result={w.preview} onOpenReal={w.openConfirm} activeJobId={w.activeJobId} />}
      <RunStatus w={w} />
    </div>
  );
}

function RealStep({ w, buttonRef }: { w: Wizard; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const { realDisabled, notice } = useReadOnlyState();
  const noticeId = useId();
  const disabled = realDisabled || w.realReason !== undefined;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card title="실제 이관">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-ink-secondary">미리보기한 패키지·아티팩트를 대상 테넌트에 업로드합니다.</p>
          {(w.activeJobId || notice) && <p id={noticeId} className="text-sm text-ink-secondary">
            {w.activeJobId ? <ActiveJobNotice jobId={w.activeJobId} /> : notice}
          </p>}
          <div className="flex justify-end">
            <Button ref={buttonRef} variant="primary" disabled={disabled} aria-describedby={w.activeJobId || notice ? noticeId : undefined}
              onClick={() => { if (!disabled) w.openConfirm(); }}>
              실제 이관 실행
            </Button>
          </div>
        </div>
      </Card>
      <RunStatus w={w} />
    </div>
  );
}
