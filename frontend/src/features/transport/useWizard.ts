import { useEffect, useRef, useState } from 'react';
import { getArtifacts, postTransport } from '../../api/client';
import { isTemplateError, toApiError, type ApiError } from '../../api/errors';
import type { ArtifactSummary, TransportRequest, TransportResponse, TransportTemplate } from '../../api/types';
import { useReadOnlyState, useTenants } from '../tenants/TenantContext';
import { hasNoTenants, REGISTER_TENANT_FIRST } from './noTenants';

// 백엔드 검증(TransportController.java)과 같은 값
export const MAX_ARTIFACTS = 100;
export const TOO_MANY_ARTIFACTS = '한 번에 100개까지 선택할 수 있습니다';

export type WizardStep = 'template' | 'package' | 'artifacts' | 'preview' | 'real';

type PackageArtifacts =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ok'; items: ArtifactSummary[]; selected: string[] };

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
  real: TransportResponse | null;
  error: ApiError | null;
  /** 실패한 요청이 템플릿 오류였으면 그 요청이 실제 이관이었는지 */
  templateFailure: { real: boolean } | null;
  confirm: { deploy: boolean } | null;
  routeDialog: boolean;
  busy: boolean;
}

const EMPTY_SELECTION = {
  packages: [] as ArtifactSummary[], packageOrder: [] as ArtifactSummary[],
  artifacts: {} as Record<string, PackageArtifacts>, previewPackages: null,
  preview: null, real: null, error: null, templateFailure: null, confirm: null, busy: false,
} satisfies Partial<WizardData>;

function initial(source: string | null, target: string | null): WizardData {
  return { route: { source, target }, step: 'template', templateDone: false, template: null, routeDialog: false, ...EMPTY_SELECTION };
}

export function useWizard() {
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

  const update = (f: (d: WizardData) => WizardData) => setData(d => { const next = f(d); latest.current = next; return next; });
  /** 결과와 진행 중인 요청을 버린다(선택이 바뀔 때). */
  const dropResults = (d: WizardData): WizardData => {
    generation.current += 1;
    inFlight.current = false;
    return { ...d, preview: null, previewPackages: null, real: null, error: null, templateFailure: null, confirm: null, busy: false };
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
  const selectionRequest = (d: WizardData): TransportRequest['packages'] => ordered(d).flatMap(p => {
    const a = d.artifacts[p.id];
    if (!a) return [{ packageId: p.id }];
    if (a.status !== 'ok' || a.selected.length === 0) return [];
    return [{ packageId: p.id, ...(a.selected.length === a.items.length ? {} : {
      artifactIds: a.items.filter(item => a.selected.includes(item.id)).map(item => item.id),
    }) }];
  });
  const tooMany = selectionRequest(data).some(p => (p.artifactIds?.length ?? 0) > MAX_ARTIFACTS);
  const pendingArtifacts = packages.some(p => {
    const a = data.artifacts[p.id];
    return a && a.status !== 'ok';
  });
  const awaitingArtifacts = pendingArtifacts || data.step === 'artifacts' && packages.some(p => !data.artifacts[p.id]);
  const noneSelected = packages.length > 0 && packages.every(p => {
    const a = data.artifacts[p.id];
    return a?.status === 'ok' && a.selected.length === 0;
  });
  const allPreviewReason = !packages.length ? '패키지를 먼저 선택하세요' : routeReason ?? (
    pendingArtifacts ? '아티팩트 목록을 확인하세요' : data.busy ? '이관 실행 중입니다' : undefined);
  const previewReason = !packages.length ? '패키지를 먼저 선택하세요' : routeReason ?? (
    awaitingArtifacts ? '아티팩트 목록을 확인하세요' : tooMany ? TOO_MANY_ARTIFACTS
      : noneSelected ? '아티팩트를 하나 이상 선택하세요' : data.busy ? '이관 실행 중입니다' : undefined);
  const realReason = notice ?? (!data.preview ? '미리보기를 먼저 실행하세요' : data.busy ? '이관 실행 중입니다' : routeReason ?? undefined);
  const loaded = packages.flatMap(p => {
    const a = data.artifacts[p.id];
    return a?.status === 'ok' ? [a] : [];
  });
  const artifactSummary = !packages.length ? null : loaded.every(a => a.selected.length === a.items.length)
    ? '전체' : `${loaded.reduce((n, a) => n + a.selected.length, 0)} / ${loaded.reduce((n, a) => n + a.items.length, 0)}개`;

  // 조회 결과는 단계 이동 뒤에도 보존한다. 경로가 바뀐 뒤 도착한 응답은 버린다.
  const artifactRequests = useRef(new Map<string, object>());
  async function loadArtifacts(packageId: string, retry = false) {
    const d = latest.current;
    if (!d.route.source || (!retry && d.artifacts[packageId])) return;
    if (artifactRequests.current.get(packageId) === d.route) return;
    artifactRequests.current.set(packageId, d.route);
    update(x => ({ ...x, artifacts: { ...x.artifacts, [packageId]: { status: 'loading' } } }));
    try {
      const items = await getArtifacts(packageId, d.route.source);
      if (latest.current.route !== d.route) return;
      update(x => ({ ...x, artifacts: { ...x.artifacts, [packageId]: { status: 'ok', items, selected: items.map(a => a.id) } } }));
    } catch (e) {
      if (latest.current.route !== d.route) return;
      update(x => ({ ...x, artifacts: { ...x.artifacts, [packageId]: { status: 'error', error: toApiError(e) } } }));
    } finally {
      if (artifactRequests.current.get(packageId) === d.route) artifactRequests.current.delete(packageId);
    }
  }
  useEffect(() => {
    if (data.step === 'artifacts') for (const p of packages) void loadArtifacts(p.id);
  }, [data.step, data.packages, data.route]);

  async function submit(real: boolean, deploy: boolean, options: { withoutTemplate?: boolean; allArtifacts?: boolean; createPackages?: string[] } = {}) {
    const d = latest.current;
    if (inFlight.current || !d.packages.length || !sourceTenantId || !targetTenantId || routeReason) return;
    if (real && (realDisabled || !d.preview)) return;
    if (!real && (options.allArtifacts ? allPreviewReason : previewReason)) return;
    const requestPackages: TransportRequest['packages'] | null = real || options.withoutTemplate ? d.previewPackages : options.allArtifacts
      ? ordered(d).map(p => ({ packageId: p.id })) : selectionRequest(d);
    if (!requestPackages?.length || requestPackages.some(p => (p.artifactIds?.length ?? 0) > MAX_ARTIFACTS)) return;
    const template = options.withoutTemplate ? null : d.template;
    const body: TransportRequest = { packages: requestPackages, dryRun: !real, deploy: real ? deploy : false, sourceTenantId, targetTenantId };
    if (real && options.createPackages?.length) body.createPackages = options.createPackages;
    if (template) body.templateId = template.id;
    inFlight.current = true;
    const gen = generation.current;
    update(x => ({
      ...x, busy: true, error: null, templateFailure: null, template, previewPackages: requestPackages,
      ...(options.allArtifacts ? { artifacts: Object.fromEntries(Object.entries(x.artifacts).map(([id, a]) =>
        [id, a.status === 'ok' && x.packages.some(p => p.id === id) ? { ...a, selected: a.items.map(item => item.id) } : a])) } : {}),
      ...(real ? {} : { preview: null, real: null }),
    }));
    try {
      const result = await postTransport(body);
      if (gen !== generation.current) return;
      update(x => (real ? { ...x, real: result, step: 'real' } : { ...x, preview: result, real: null, step: 'preview' }));
    } catch (e) {
      if (gen !== generation.current) return;
      const error = toApiError(e);
      update(x => ({ ...x, error, templateFailure: template && isTemplateError(error) ? { real } : null }));
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        update(x => ({ ...x, busy: false, confirm: null }));
      }
    }
  }

  return {
    ...data,
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
    canGo(step: WizardStep) {
      if (step === 'template') return true;
      if (step === 'package') return data.templateDone || data.packages.length > 0;
      if (step === 'artifacts') return data.packages.length > 0;
      return data.preview !== null;
    },
    goStep(step: WizardStep) {
      update(d => ({ ...d, step }));
    },
    /** 처음(템플릿 단계)부터 다시 시작한다. */
    restart() {
      generation.current += 1;
      inFlight.current = false;
      update(d => ({ ...initial(d.route.source, d.route.target) }));
    },
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
    setArtifactIds(packageId: string, ids: string[]) {
      update(d => {
        const a = d.artifacts[packageId];
        return a?.status === 'ok' ? { ...dropResults(d), artifacts: { ...d.artifacts, [packageId]: { ...a, selected: ids } } } : d;
      });
    },
    selectAllArtifacts(select: boolean) {
      update(d => ({ ...dropResults(d), artifacts: Object.fromEntries(Object.entries(d.artifacts).map(([id, a]) =>
        [id, a.status === 'ok' && d.packages.some(p => p.id === id) ? { ...a, selected: select ? a.items.map(item => item.id) : [] } : a])) }));
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
      if (realDisabled || !d.preview || inFlight.current || routeReason) return;
      update(x => ({ ...x, confirm: { deploy: false } }));
    },
    setConfirmDeploy(deploy: boolean) {
      update(d => (d.confirm ? { ...d, confirm: { deploy } } : d));
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
