import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelTransportJob, getArtifacts, startTransportJob } from '../../api/client';
import { ApiRequestError, isTemplateError, JOB_ALREADY_RUNNING, toApiError, type ApiError } from '../../api/errors';
import type { ActiveJob, ArtifactSummary, ArtifactType, JobItem, TransportRequest, TransportResponse, TransportTemplate } from '../../api/types';
import { useReadOnlyState, useTenants } from '../tenants/TenantContext';
import { hasNoTenants, REGISTER_TENANT_FIRST } from './noTenants';
import { jobHref } from '../../app/routes';
import { useJobPolling } from '../job/useJobPolling';

// 백엔드 검증(TransportController.java)과 같은 값
export const MAX_ARTIFACTS = 100;
export const TOO_MANY_ARTIFACTS = '한 번에 100개까지 선택할 수 있습니다';

export type WizardStep = 'template' | 'package' | 'artifacts' | 'preview' | 'real';

const NEW_TYPES = ['SCRIPT_COLLECTION', 'MESSAGE_MAPPING', 'VALUE_MAPPING'] as const;
export const ARTIFACT_TYPES = ['INTEGRATION_FLOW', ...NEW_TYPES] as const;

type ArtifactListState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ok'; items: ArtifactSummary[]; selected: string[] };

type PackageArtifacts = Partial<Record<ArtifactType, ArtifactListState>>;

export function artifactCounts(lists: PackageArtifacts = {}) {
  let total = 0, selected = 0;
  for (const list of Object.values(lists)) {
    if (list.status === 'ok') {
      total += list.items.length;
      selected += list.selected.length;
    }
  }
  return { total, selected };
}

function selectAllInPackage(lists: PackageArtifacts, select: boolean): PackageArtifacts {
  const next = { ...lists };
  for (const type of ARTIFACT_TYPES) {
    const list = lists[type];
    if (list?.status === 'ok') next[type] = { ...list, selected: select ? list.items.map(a => a.id) : [] };
  }
  return next;
}

function selectionRequest(packageId: string, lists: PackageArtifacts = {}, allArtifacts = false): TransportRequest['packages'] {
  const flow = lists.INTEGRATION_FLOW;
  const { selected } = artifactCounts(lists);
  if (flow && (flow.status !== 'ok' || !selected)) return [];
  const ids = (type: ArtifactType) => {
    const list = lists[type];
    return list?.status === 'ok' ? list.selected : [];
  };
  const explicitFlows = !allArtifacts && flow && (!flow.selected.length || flow.selected.length < flow.items.length);
  return [{
    packageId, ...(explicitFlows ? { artifactIds: flow.selected } : {}),
    scriptCollectionIds: ids('SCRIPT_COLLECTION'),
    messageMappingIds: ids('MESSAGE_MAPPING'),
    valueMappingIds: ids('VALUE_MAPPING'),
  }];
}

interface PreviewJob extends ActiveJob {
  items: JobItem[] | null;
  pollFailed: boolean;
  cancelRequested: boolean;
}

interface WizardData {
  /** 이 상태가 속한 경로. TenantContext의 원본·대상과 다르면 선택·결과·템플릿 연결을 비운다. */
  route: { source: string | null; target: string | null };
  step: WizardStep;
  /** 템플릿 단계를 마쳤는지(템플릿을 골랐거나 "템플릿 없이 진행") */
  templateDone: boolean;
  template: TransportTemplate | null;
  packages: ArtifactSummary[];
  packageOrder: ArtifactSummary[];
  artifacts: Record<string, PackageArtifacts>;
  previewPackages: TransportRequest['packages'] | null;
  preview: TransportResponse | null;
  previewJob: PreviewJob | null;
  previewCancelled: boolean;
  error: ApiError | null;
  /** 실패한 요청이 템플릿 오류였으면 그 요청이 실제 이관이었는지 */
  templateFailure: { real: boolean } | null;
  confirm: { deploy: boolean; conflictJobId?: string } | null;
  routeDialog: boolean;
  busy: boolean;
}

const EMPTY_SELECTION = {
  packages: [] as ArtifactSummary[], packageOrder: [] as ArtifactSummary[],
  artifacts: {} as Record<string, PackageArtifacts>, previewPackages: null,
  preview: null, previewJob: null, previewCancelled: false, error: null, templateFailure: null, confirm: null, busy: false,
} satisfies Partial<WizardData>;

function initial(source: string | null, target: string | null): WizardData {
  return { route: { source, target }, step: 'template', templateDone: false, template: null, routeDialog: false, ...EMPTY_SELECTION };
}

function selectAllInPackages(d: WizardData, select: boolean) {
  const artifacts = { ...d.artifacts };
  for (const { id } of d.packages) artifacts[id] = selectAllInPackage(artifacts[id] ?? {}, select);
  return artifacts;
}

export function useWizard(visible = true, activeJobId?: string) {
  const { tenants, sourceTenantId, targetTenantId, setSourceTenantId, setTargetTenantId } = useTenants();
  const { realDisabled, notice } = useReadOnlyState();
  const [stored, setData] = useState(() => initial(sourceTenantId, targetTenantId));
  let data = stored;
  // AI-NOTE: 같은 틱의 연속 클릭은 상태 갱신(busy)만으로 막지 못한다. 동기 플래그로 중복 전송을 막는다 (근거: REQ-005 AC-4, REQ-423)
  const inFlight = useRef(false);
  // 선택·경로가 바뀌면 세대를 올려 진행 중이던 이전 요청의 응답을 버린다(REQ-308 AC-5).
  const generation = useRef(0);

  // AI-NOTE: 팔레트·상태 칩 등 어디서든 TenantContext의 원본·대상이 바뀌면 같은 렌더에서 선택·결과·템플릿 연결을 비운다. 템플릿 적용은 route를 함께 바꿔 여기에 걸리지 않는다 (근거: REQ-420, REQ-308 AC-5)
  if (data.route.source !== sourceTenantId || data.route.target !== targetTenantId) {
    generation.current += 1;
    inFlight.current = false;
    data = {
      ...data, ...EMPTY_SELECTION, template: null, route: { source: sourceTenantId, target: targetTenantId },
      step: data.step === 'template' ? 'template' : 'package',
    };
    setData(data);
  }
  // AI-NOTE: 읽기 전용(켜짐·모름·조회 실패) 또는 대상 연결 확인 실패면 같은 렌더에서 확인창을 닫는다 (근거: REQ-423, REQ-430, REQ-302 AC-5)
  if (realDisabled && data.confirm) {
    data = { ...data, confirm: null };
    setData(data);
  }
  const latest = useRef(data);
  latest.current = data;

  const update = useCallback((f: (d: WizardData) => WizardData) => setData(d => { const next = f(d); latest.current = next; return next; }), []);
  /** 결과와 진행 중인 요청을 버린다(선택이 바뀔 때). */
  const dropResults = (d: WizardData): WizardData => {
    generation.current += 1;
    inFlight.current = false;
    return { ...d, preview: null, previewJob: null, previewCancelled: false, previewPackages: null, error: null, templateFailure: null, confirm: null, busy: false };
  };

  const list = tenants.state === 'success' ? tenants.data.tenants : [];
  const tenantName = (id: string | null) => (id === null ? null : list.find(t => t.id === id)?.name ?? id);
  const routeReason = !sourceTenantId ? (hasNoTenants(tenants) ? REGISTER_TENANT_FIRST : '원본 테넌트를 선택하세요')
    : !targetTenantId ? '대상 테넌트를 선택하세요'
    : sourceTenantId === targetTenantId ? '원본과 대상이 같습니다' : null;
  const ordered = (d: WizardData) => [
    ...d.packageOrder.filter(p => d.packages.some(selected => selected.id === p.id)),
    ...d.packages.filter(p => !d.packageOrder.some(item => item.id === p.id)),
  ];
  const packages = ordered(data);
  const selections = packages.flatMap(p => selectionRequest(p.id, data.artifacts[p.id]));
  const tooMany = selections.some(p => (p.artifactIds?.length ?? 0) > MAX_ARTIFACTS);
  const pendingArtifacts = packages.some(p => ARTIFACT_TYPES.some(type => {
    const state = data.artifacts[p.id]?.[type]?.status;
    return state === 'loading' || type === 'INTEGRATION_FLOW' && state === 'error';
  }));
  const missingLists = packages.some(p => ARTIFACT_TYPES.some(type => !data.artifacts[p.id]?.[type]));
  const awaitingArtifacts = pendingArtifacts || data.step === 'artifacts' && missingLists;
  const noneSelected = packages.length > 0 && !missingLists && !pendingArtifacts && selections.length === 0;
  const busy = data.busy || data.previewJob !== null;
  const allPreviewReason = !packages.length ? '패키지를 먼저 선택하세요' : routeReason ?? (
    pendingArtifacts ? '아티팩트 목록을 확인하세요' : busy ? '이관 실행 중입니다' : undefined);
  const previewReason = !packages.length ? '패키지를 먼저 선택하세요' : routeReason ?? (
    awaitingArtifacts ? '아티팩트 목록을 확인하세요' : tooMany ? TOO_MANY_ARTIFACTS
      : noneSelected ? '아티팩트를 하나 이상 선택하세요' : busy ? '이관 실행 중입니다' : undefined);
  const realReason = activeJobId ? JOB_ALREADY_RUNNING : notice ?? (!data.preview ? '미리보기를 먼저 실행하세요' : busy ? '이관 실행 중입니다' : routeReason ?? undefined);
  const counts = packages.map(p => artifactCounts(data.artifacts[p.id]));
  const total = counts.reduce((n, c) => n + c.total, 0);
  const selected = counts.reduce((n, c) => n + c.selected, 0);
  const artifactSummary = !packages.length ? null : selected === total ? '전체' : `${selected} / ${total}개`;

  // 조회 결과는 단계 이동 뒤에도 보존한다. 경로가 바뀐 뒤 도착한 응답은 버린다.
  const artifactRequests = useRef(new Map<string, { route: WizardData['route']; promise: Promise<ArtifactListState> }>());
  async function loadArtifacts(packageId: string, type: ArtifactType, retry = false) {
    const { route, artifacts } = latest.current;
    if (!route.source) return;
    const key = type + ':' + packageId;
    const pending = artifactRequests.current.get(key);
    if (pending?.route === route) return pending.promise;
    const cached = artifacts[packageId]?.[type];
    if (cached && !retry) return cached;

    function setList(list: ArtifactListState) {
      update(d => d.route !== route ? d : { ...d, artifacts: { ...d.artifacts,
        [packageId]: { ...d.artifacts[packageId], [type]: list },
      } });
    }
    if (retry) update(dropResults);
    setList({ status: 'loading' });
    const promise = getArtifacts(packageId, route.source, type === 'INTEGRATION_FLOW' ? undefined : type)
      .then((items): ArtifactListState => ({ status: 'ok', items, selected: items.map(a => a.id) }))
      .catch((e): ArtifactListState => ({ status: 'error', error: toApiError(e) }));
    artifactRequests.current.set(key, { route, promise });
    const list = await promise;
    if (artifactRequests.current.get(key)?.promise === promise) artifactRequests.current.delete(key);
    setList(list);
    return list;
  }
  useEffect(() => {
    if (data.step === 'artifacts') {
      for (const p of packages) for (const type of ARTIFACT_TYPES) void loadArtifacts(p.id, type);
    }
  }, [data.step, data.packages, data.route]);

  // 화면을 떠나거나 선택을 바꾸면 예약된 조회와 뒤늦게 도착한 응답을 함께 버린다.
  const pollingId = visible && !data.previewJob?.pollFailed ? data.previewJob?.jobId : undefined;
  useJobPolling(pollingId, job => {
    update(d => {
      if (!d.previewJob || d.previewJob.jobId !== job.jobId) return d;
      if (job.status === 'RUNNING') return { ...d, previewJob: { ...d.previewJob, done: job.done, total: job.total, items: job.items } };
      const completed = job.status === 'COMPLETED';
      return { ...d, step: 'preview', previewJob: null, previewCancelled: !completed, preview: completed ? job.result : null, error: null };
    });
  }, () => update(d => d.previewJob ? { ...d, previewJob: { ...d.previewJob, pollFailed: true } } : d));

  async function cancelPreview() {
    const job = latest.current.previewJob;
    if (!job || job.cancelRequested) return;
    const gen = generation.current;
    update(d => d.previewJob ? { ...d, error: null, previewJob: { ...d.previewJob, cancelRequested: true } } : d);
    try {
      await cancelTransportJob(job.jobId);
    } catch (e) {
      // 완료와 취소가 겹치면 다음 조회에서 서버의 최종 상태를 표시한다.
      if (gen !== generation.current || e instanceof ApiRequestError && e.status === 409) return;
      update(d => d.previewJob?.jobId === job.jobId ? { ...d, error: toApiError(e),
        previewJob: { ...d.previewJob, cancelRequested: false } } : d);
    }
  }

  // 패키지 단계의 단축 실행과 팔레트 실행은 iFlow를 읽지 않고도 요청할 수 있다.
  async function preparePackage(packageId: string, cached: PackageArtifacts = {}, all = false) {
    const lists = { ...cached };
    const required = NEW_TYPES.filter(type => all || !lists[type]);
    await Promise.all(required.map(async type => { lists[type] = await loadArtifacts(packageId, type); }));
    if (required.some(type => lists[type]?.status !== 'ok')) return null;
    return selectionRequest(packageId, all ? selectAllInPackage(lists, true) : lists, all);
  }

  async function submit(real: boolean, deploy: boolean, options: { withoutTemplate?: boolean; allArtifacts?: boolean; createPackages?: string[] } = {}) {
    const d = latest.current;
    if (inFlight.current || d.previewJob || !d.packages.length || !sourceTenantId || !targetTenantId || routeReason) return;
    if (real && (realDisabled || activeJobId || d.confirm?.conflictJobId || !d.preview)) return;
    if (!real && (options.allArtifacts ? allPreviewReason : previewReason)) return;
    const template = options.withoutTemplate ? null : d.template;
    inFlight.current = true;
    const gen = generation.current;
    update(x => ({
      ...x, busy: true, error: null, templateFailure: null, template,
      ...(real ? {} : { preview: null, previewCancelled: false }),
    }));
    try {
      let requestPackages = selections;
      if (real || options.withoutTemplate) {
        requestPackages = d.previewPackages ?? [];
      } else if (options.allArtifacts || missingLists) {
        const prepared = await Promise.all(ordered(d).map(p => preparePackage(p.id, d.artifacts[p.id], options.allArtifacts)));
        if (gen !== generation.current) return;
        requestPackages = prepared.flatMap(p => p ?? []);
        if (prepared.includes(null) || !requestPackages.length) {
          update(x => ({ ...x, step: 'artifacts', previewPackages: null }));
          return;
        }
        if (options.allArtifacts) {
          update(x => ({ ...x, artifacts: selectAllInPackages(x, true) }));
        }
      }
      if (!requestPackages.length || requestPackages.some(p => (p.artifactIds?.length ?? 0) > MAX_ARTIFACTS)) return;
      update(x => ({ ...x, previewPackages: requestPackages }));
      const body: TransportRequest = { packages: requestPackages, dryRun: !real, deploy: real ? deploy : false, sourceTenantId, targetTenantId };
      if (real && d.preview) body.previewId = d.preview.transportId;
      if (real && options.createPackages?.length) body.createPackages = options.createPackages;
      if (template) body.templateId = template.id;
      const { jobId, total } = await startTransportJob(body);
      if (gen !== generation.current) return;
      if (real) {
        restart();
        window.location.hash = jobHref(jobId);
      } else {
        update(x => ({ ...x, step: 'preview', previewJob: { jobId, total, done: 0, items: null, pollFailed: false, cancelRequested: false } }));
      }
    } catch (e) {
      if (gen !== generation.current) return;
      const error = toApiError(e);
      if (real && error.activeJobId) {
        update(x => ({ ...x, confirm: x.confirm && { ...x.confirm, conflictJobId: error.activeJobId } }));
      } else {
        update(x => ({ ...x, error, templateFailure: template && isTemplateError(error) ? { real } : null, confirm: null }));
      }
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        update(x => ({ ...x, busy: false }));
      }
    }
  }

  function restart() {
    generation.current += 1;
    inFlight.current = false;
    update(d => initial(d.route.source, d.route.target));
  }

  return {
    ...data,
    busy,
    cancelPreview,
    retryPreviewPoll() {
      update(d => d.previewJob ? { ...d, previewJob: { ...d.previewJob, pollFailed: false } } : d);
    },
    packages,
    artifactSummary,
    noneSelected,
    loadArtifacts,
    tenantName,
    routeText: `${tenantName(sourceTenantId) ?? '원본 선택 안 됨'} → ${tenantName(targetTenantId) ?? '대상 선택 안 됨'}`,
    targetName: tenantName(targetTenantId) ?? '대상',
    routeReason,
    tooMany,
    previewReason,
    allPreviewReason,
    realReason,
    realDisabled,
    activeJobId,
    canGo(step: WizardStep) {
      if (step === 'template') return true;
      if (step === 'package') return data.templateDone || data.packages.length > 0;
      if (step === 'artifacts') return data.packages.length > 0;
      if (step === 'preview') return Boolean(data.preview || data.previewJob || data.previewCancelled);
      return data.preview !== null;
    },
    goStep(step: WizardStep) {
      update(d => ({ ...d, step }));
    },
    /** 처음(템플릿 단계)부터 다시 시작한다. */
    restart,
    startManual() {
      update(d => ({ ...d, step: 'package', templateDone: true, template: null }));
    },
    applyTemplate(t: TransportTemplate) {
      if (!t.usable) return;
      generation.current += 1;
      inFlight.current = false;
      setSourceTenantId(t.sourceTenantId);
      setTargetTenantId(t.targetTenantId);
      update(() => ({
        ...initial(t.sourceTenantId, t.targetTenantId), step: 'package', templateDone: true, template: t,
      }));
    },
    /** 대기 항목 전달: 템플릿 경로·연결을 유지하고 대기 패키지의 아티팩트 단계만 연다. 실행은 사용자가 요청한다. */
    forwardPackage(t: TransportTemplate, packageId: string) {
      if (!t.usable) return;
      generation.current += 1;
      inFlight.current = false;
      setSourceTenantId(t.sourceTenantId);
      setTargetTenantId(t.targetTenantId);
      update(() => ({
        ...initial(t.sourceTenantId, t.targetTenantId), step: 'artifacts', templateDone: true, template: t,
        packages: [{ id: packageId, name: packageId, version: '' }],
      }));
    },
    /** 팔레트의 패키지 항목: 템플릿 연결 없이 그 패키지가 선택된 아티팩트 단계 */
    openPackage(pkg: ArtifactSummary) {
      generation.current += 1;
      inFlight.current = false;
      update(d => ({ ...initial(d.route.source, d.route.target), step: 'artifacts', templateDone: true, packages: [pkg] }));
    },
    setPackageOrder(packageOrder: ArtifactSummary[]) {
      update(d => d.packageOrder === packageOrder ? d : { ...d, packageOrder });
    },
    selectPackage(pkg: ArtifactSummary) {
      update(d => ({ ...dropResults(d), packages: d.packages.some(p => p.id === pkg.id)
        ? d.packages.filter(p => p.id !== pkg.id) : [...d.packages, pkg] }));
    },
    addPackages(items: ArtifactSummary[]) {
      update(d => ({ ...dropResults(d), packages: [...d.packages, ...items.filter(p => !d.packages.some(s => s.id === p.id))] }));
    },
    clearPackages() { update(d => ({ ...dropResults(d), packages: [] })); },
    setArtifactIds(packageId: string, type: ArtifactType, ids: string[]) {
      update(d => {
        const lists = d.artifacts[packageId];
        const list = lists?.[type];
        return list?.status === 'ok' ? { ...dropResults(d), artifacts: { ...d.artifacts,
          [packageId]: { ...lists, [type]: { ...list, selected: ids } },
        } } : d;
      });
    },
    selectAllArtifacts(select: boolean) {
      update(d => ({ ...dropResults(d), artifacts: selectAllInPackages(d, select) }));
    },
    openRouteDialog() { update(d => ({ ...d, routeDialog: true })); },
    closeRouteDialog() { update(d => ({ ...d, routeDialog: false })); },
    changeRoute(source: string, target: string) {
      if (source === sourceTenantId && target === targetTenantId) {
        update(d => ({ ...d, routeDialog: false }));
        return;
      }
      generation.current += 1;
      inFlight.current = false;
      setSourceTenantId(source);
      setTargetTenantId(target);
      update(d => ({ ...d, ...EMPTY_SELECTION, template: null, routeDialog: false, route: { source, target }, step: 'package', templateDone: true }));
    },
    runPreview(options: { allArtifacts?: boolean } = {}) {
      void submit(false, false, options);
    },
    openConfirm() {
      const d = latest.current;
      if (realDisabled || activeJobId || !d.preview || inFlight.current || routeReason) return;
      update(x => ({ ...x, confirm: { deploy: false } }));
    },
    setConfirmDeploy(deploy: boolean) {
      update(d => (d.confirm ? { ...d, confirm: { ...d.confirm, deploy } } : d));
    },
    cancelConfirm() {
      if (inFlight.current) return;
      update(d => ({ ...d, confirm: null }));
    },
    confirmReal(createPackages: string[]) {
      const d = latest.current;
      if (!d.confirm) return;
      void submit(true, d.confirm.deploy, { createPackages });
    },
    /** 템플릿 오류 뒤: 템플릿 연결을 풀고 같은 구성으로 다시 실행한다. 실제 이관이었으면 확인창만 다시 연다(ADR-008). */
    retryWithoutTemplate() {
      const d = latest.current;
      if (!d.templateFailure || inFlight.current) return;
      if (d.templateFailure.real) {
        update(x => ({ ...x, template: null, error: null, templateFailure: null, confirm: realDisabled ? null : { deploy: false } }));
      } else {
        void submit(false, false, { withoutTemplate: true });
      }
    },
  };
}

export type Wizard = ReturnType<typeof useWizard>;
