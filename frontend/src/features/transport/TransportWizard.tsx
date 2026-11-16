import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { getArtifacts, getPackages, getTemplates } from '../../api/client';
import type { ArtifactSummary, TransportTemplate } from '../../api/types';
import { navigate } from '../../app/routes';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { PageHeader } from '../../components/ui/PageHeader';
import { RadioControl } from '../../components/ui/Radio';
import { TextInput } from '../../components/ui/TextInput';
import { useRemote } from '../../lib/useRemote';
import { TransportResult } from '../result/TransportResult';
import { templateReason } from '../templates/TemplatesScreen';
import { useReadOnlyState, useTenants } from '../tenants/TenantContext';
import { ArtifactGrid } from './ArtifactGrid';
import { ConfirmDialog } from './ConfirmDialog';
import { REGISTER_TENANT_FIRST, hasNoTenants } from './noTenants';
import { RouteDialog } from './RouteDialog';
import { TOO_MANY_ARTIFACTS, type Wizard, type WizardStep } from './useWizard';

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
      {w.confirm && !w.realDisabled && w.pkg && (
        <ConfirmDialog
          targetName={w.targetName}
          routeText={w.routeText}
          packageId={w.pkg.id}
          artifactCount={w.artifactIds.length}
          deploy={w.confirm.deploy}
          onDeployChange={w.setConfirmDeploy}
          busy={w.busy}
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
    package: w.pkg && w.pendingPackage === null ? w.pkg.name : w.pkg?.id ?? null,
    artifacts: !w.pkg || (!w.preview && w.artifactIds.length === 0) ? null
      : w.artifactIds.length === 0 ? '전체' : `${w.artifactIds.length} / ${w.artifactTotal ?? '?'}개`,
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
      {w.busy && !w.confirm && <p role="status" className="text-sm text-ink-secondary">이관 실행 중</p>}
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
                  <p className="font-mono text-[13px] text-ink-secondary break-all">{t.packageId || '실행 때 선택'}</p>
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
  const { resolvePackage } = w;
  const data = state.status === 'ok' ? state.data : null;
  useEffect(() => { if (data && w.pendingPackage !== null) resolvePackage(data); }, [data, w.pendingPackage]);

  if (state.status === 'loading') return <ListSkeleton />;
  if (state.status === 'error') return <ErrorAlert error={state.error} onRetry={retry} />;
  // 정규식이 아니라 includes로 비교한다: ( [ 같은 입력도 글자 그대로 취급된다.
  const q = query.toLowerCase();
  const shown = state.data.filter(p => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  const selectedId = w.pkg?.id ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {w.missingPackage !== null && <p className="rounded-md bg-warning-bg px-3 py-2.5 text-warning-fg">{`템플릿의 패키지(${w.missingPackage})를 원본에서 찾을 수 없습니다. 패키지를 다시 고르세요`}</p>}
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
                  <label className={`${ROW_BASE} ${selectedId === p.id ? 'bg-primary-soft' : 'hover:bg-surface-hover'}`}>
                    <RadioControl name="package" checked={selectedId === p.id} onChange={() => w.selectPackage(p)} />
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
        <Button disabled={!w.pkg || w.previewReason !== undefined && w.previewReason !== TOO_MANY_ARTIFACTS} onClick={() => w.runPreview({ allArtifacts: true })}>
          전체 아티팩트로 미리보기
        </Button>
        <Button variant="primary" disabled={!w.pkg} onClick={() => w.goStep('artifacts')}>다음</Button>
      </div>
    </div>
  );
}

function ArtifactStep({ w }: { w: Wizard }) {
  const { sourceTenantId } = useTenants();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {w.pkg && sourceTenantId
        ? <ArtifactList key={`${sourceTenantId}:${w.pkg.id}`} w={w} source={sourceTenantId} packageId={w.pkg.id} />
        : <Card title="아티팩트"><EmptyState title="패키지를 먼저 선택하세요" /></Card>}
      {w.tooMany && <p className="text-sm text-danger-fg">{`${TOO_MANY_ARTIFACTS}. 선택을 줄이세요`}</p>}
      {w.artifactIds.length === 0 && w.pkg && <p className="text-sm text-ink-secondary">패키지의 모든 아티팩트가 대상</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => w.goStep('package')}>이전</Button>
        <Button variant="primary" disabled={w.previewReason !== undefined} onClick={() => w.runPreview()}>미리보기 실행</Button>
      </div>
      <RunStatus w={w} />
    </div>
  );
}

function ArtifactList({ w, source, packageId }: { w: Wizard; source: string; packageId: string }) {
  const { state, retry } = useRemote(() => getArtifacts(packageId, source), `artifacts:${source}:${packageId}`);
  const { setArtifactTotal } = w;
  const total = state.status === 'ok' ? state.data.length : null;
  useEffect(() => { if (total !== null) setArtifactTotal(total); }, [total]);
  if (state.status === 'loading') return <Card title="아티팩트"><ListSkeleton /></Card>;
  if (state.status === 'error') return <Card title="아티팩트"><ErrorAlert error={state.error} onRetry={retry} /></Card>;
  const list = state.data;
  return (
    <Card
      title="아티팩트"
      meta={`${w.artifactIds.length}개 선택 / 전체 ${list.length}개`}
      actions={<>
        <Button size="sm" onClick={() => w.setArtifactIds(list.map(a => a.id))}>전체 선택</Button>
        <Button size="sm" onClick={() => w.setArtifactIds([])}>선택 해제</Button>
      </>}
    >
      {list.length === 0 ? <EmptyState title="아티팩트가 없습니다" />
        : <div className="max-h-[420px] min-w-0 overflow-y-auto"><ArtifactGrid artifacts={list} selectedIds={w.artifactIds} onChange={w.setArtifactIds} /></div>}
    </Card>
  );
}

function PreviewStep({ w }: { w: Wizard }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {w.preview && <TransportResult result={w.preview} onOpenReal={w.openConfirm} />}
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
        <div className="flex min-w-0 flex-col items-start gap-3">
          <p className="text-sm text-ink-secondary">{`미리보기와 같은 구성(${w.routeText})으로 ${w.targetName}에 업로드합니다.`}</p>
          <Button ref={buttonRef} variant="primary" disabled={disabled} aria-describedby={notice ? noticeId : undefined}
            onClick={() => { if (!disabled) w.openConfirm(); }}>
            {`${w.targetName}로 이관`}
          </Button>
          {notice && <p id={noticeId} className="text-sm text-ink-secondary">{notice}</p>}
        </div>
      </Card>
      {w.real && <TransportResult result={w.real} />}
      <RunStatus w={w} />
    </div>
  );
}
