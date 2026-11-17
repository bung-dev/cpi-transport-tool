import { useRef, useState } from 'react';
import { postTransport } from '../../api/client';
import { isTemplateError, toApiError, type ApiError } from '../../api/errors';
import type { ArtifactSummary, TransportRequest, TransportResponse, TransportTemplate } from '../../api/types';
import { useReadOnlyState, useTenants } from '../tenants/TenantContext';
import { hasNoTenants, REGISTER_TENANT_FIRST } from './noTenants';

// 백엔드 검증(TransportController.java)과 같은 값
export const MAX_ARTIFACTS = 100;
export const TOO_MANY_ARTIFACTS = '한 번에 100개까지 선택할 수 있습니다';

export type WizardStep = 'template' | 'package' | 'artifacts' | 'preview' | 'real';

interface WizardData {
  /** 이 상태가 속한 경로. TenantContext의 원본·대상과 다르면 선택·결과·템플릿 연결을 비운다. */
  route: { source: string | null; target: string | null };
  step: WizardStep;
  /** 템플릿 단계를 마쳤는지(템플릿을 골랐거나 "템플릿 없이 진행") */
  templateDone: boolean;
  template: TransportTemplate | null;
  pkg: ArtifactSummary | null;
  /** 템플릿의 패키지가 원본 목록에 있는지 아직 확인하지 않았으면 그 ID */
  pendingPackage: string | null;
  /** 템플릿의 패키지가 원본에 없었으면 그 ID */
  missingPackage: string | null;
  artifactIds: string[];
  artifactTotal: number | null;
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
  pkg: null, pendingPackage: null, missingPackage: null, artifactIds: [] as string[], artifactTotal: null,
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
    return { ...d, preview: null, real: null, error: null, templateFailure: null, confirm: null, busy: false };
  };

  const list = tenants.state === 'success' ? tenants.data.tenants : [];
  const tenantName = (id: string | null) => (id === null ? null : list.find(t => t.id === id)?.name ?? id);
  const routeReason = !sourceTenantId ? (hasNoTenants(tenants) ? REGISTER_TENANT_FIRST : '원본 테넌트를 선택하세요')
    : !targetTenantId ? '대상 테넌트를 선택하세요'
    : sourceTenantId === targetTenantId ? '원본과 대상이 같습니다' : null;
  const tooMany = data.artifactIds.length > MAX_ARTIFACTS;
  const previewReason = !data.pkg ? '패키지를 먼저 선택하세요' : routeReason ?? (tooMany ? TOO_MANY_ARTIFACTS : data.busy ? '이관 실행 중입니다' : undefined);
  const realReason = notice ?? (!data.preview ? '미리보기를 먼저 실행하세요' : data.busy ? '이관 실행 중입니다' : routeReason ?? undefined);

  async function submit(real: boolean, deploy: boolean, options: { withoutTemplate?: boolean; allArtifacts?: boolean } = {}) {
    const d = latest.current;
    if (inFlight.current || !d.pkg || !sourceTenantId || !targetTenantId || routeReason) return;
    if (real && (realDisabled || !d.preview)) return;
    const ids = options.allArtifacts ? [] : d.artifactIds;
    if (ids.length > MAX_ARTIFACTS) return;
    const template = options.withoutTemplate ? null : d.template;
    // 선택 0개면 artifactIds 키를 보내지 않는다(패키지 전체). 미리보기는 항상 deploy: false다.
    const body: TransportRequest = { packageId: d.pkg.id, dryRun: !real, deploy: real ? deploy : false, sourceTenantId, targetTenantId };
    if (ids.length > 0) body.artifactIds = ids;
    if (template) body.templateId = template.id;
    inFlight.current = true;
    const gen = generation.current;
    update(x => ({ ...x, busy: true, error: null, templateFailure: null, template, artifactIds: ids, ...(real ? {} : { preview: null, real: null }) }));
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
    tenantName,
    routeText: `${tenantName(sourceTenantId) ?? '원본 선택 안 됨'} → ${tenantName(targetTenantId) ?? '대상 선택 안 됨'}`,
    targetName: tenantName(targetTenantId) ?? '대상',
    routeReason,
    tooMany,
    previewReason,
    realReason,
    realDisabled,
    canGo(step: WizardStep) {
      if (step === 'template') return true;
      if (step === 'package') return data.templateDone || data.pkg !== null;
      if (step === 'artifacts') return data.pkg !== null;
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
        pkg: t.packageId ? { id: t.packageId, name: t.packageId, version: '' } : null, pendingPackage: t.packageId ?? null,
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
        pkg: { id: packageId, name: packageId, version: '' },
      }));
    },
    /** 팔레트의 패키지 항목: 템플릿 연결 없이 그 패키지가 선택된 아티팩트 단계 */
    openPackage(pkg: ArtifactSummary) {
      generation.current += 1;
      inFlight.current = false;
      update(d => ({ ...initial(d.route.source, d.route.target), step: 'artifacts', templateDone: true, pkg }));
    },
    /** 패키지 단계가 원본 목록을 받으면 템플릿 패키지를 확인한다. */
    resolvePackage(packages: ArtifactSummary[]) {
      update(d => {
        if (d.pendingPackage === null) return d;
        const found = packages.find(p => p.id === d.pendingPackage);
        if (found) return { ...d, pendingPackage: null, pkg: d.pkg?.id === found.id ? found : d.pkg };
        if (d.pkg?.id !== d.pendingPackage) return { ...d, pendingPackage: null };
        return { ...dropResults(d), pendingPackage: null, missingPackage: d.pendingPackage, pkg: null, artifactIds: [], artifactTotal: null };
      });
    },
    selectPackage(pkg: ArtifactSummary) {
      update(d => (d.pkg?.id === pkg.id ? d
        : { ...dropResults(d), pkg, pendingPackage: null, missingPackage: null, artifactIds: [], artifactTotal: null }));
    },
    setArtifactIds(ids: string[]) {
      update(d => ({ ...dropResults(d), artifactIds: ids }));
    },
    setArtifactTotal(total: number) {
      update(d => (d.artifactTotal === total ? d : { ...d, artifactTotal: total }));
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
    confirmReal() {
      const d = latest.current;
      if (!d.confirm) return;
      void submit(true, d.confirm.deploy);
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
