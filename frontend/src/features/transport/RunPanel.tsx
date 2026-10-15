import { useRef, useState, type ReactNode } from 'react';
import { postTransport } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { TransportRequest, TransportResponse } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Switch } from '../../components/ui/Switch';
import { ConfirmDialog } from './ConfirmDialog';
import { useTenants } from '../tenants/TenantContext';
import { RunModeSelect, type RunMode } from './RunModeSelect';

// 백엔드 검증(TransportController.java:31)과 같은 값
export const MAX_ARTIFACTS = 100;

interface Props {
  packageId: string | null;
  /** 요약 줄에 보일 선택한 패키지의 name. 없으면 id만 보인다. */
  packageName?: string | null;
  artifactIds: string[];
  onResult: (r: TransportResponse | null) => void;
  /** 전송 직전에 요청 본문을 알린다("이 구성으로 실제 이관"이 드라이런 요청의 선택을 되살리는 데 쓴다). */
  onRequest?: (body: TransportRequest) => void;
  /**
   * "이 구성으로 실제 이관"의 요청 번호. 값이 바뀌면 실행 모드를 실제 이관으로, 배포를 꺼짐으로 맞추고 확인 대화상자를 연다(REQ-105 AC-6, D-018 ①).
   * 확인 대화상자와 전송 경로는 이 컴포넌트의 것 하나만 쓴다(ADR-008, 중복 전송 방지).
   */
  realRequest?: number;
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <dt className="pt-px text-xs text-ink-tertiary">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}

export function RunPanel({ packageId, packageName, artifactIds, onResult, onRequest, realRequest = 0 }: Props) {
  const { tenants, sourceTenantId, targetTenantId } = useTenants();
  const targetName = tenants.state === 'success'
    ? tenants.data.tenants.find(t => t.id === targetTenantId)?.name ?? 'PRD' : 'PRD';
  const selectionReason = !sourceTenantId ? '원본 테넌트를 선택하세요'
    : !targetTenantId ? '대상 테넌트를 선택하세요'
    : sourceTenantId === targetTenantId ? '원본과 대상이 같습니다' : null;
  const [mode, setMode] = useState<RunMode>('dryRun');
  const [deploy, setDeploy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // AI-NOTE: 상태 갱신(busy)은 비동기라 disabled만으로는 같은 틱의 연속 클릭을 막지 못한다. 동기 플래그로 중복 전송을 막는다 (근거: REQ-005 AC-4, run 20260929-frontend-ui)
  const inFlight = useRef(false);
  const runBtn = useRef<HTMLButtonElement>(null);

  // 요청 번호가 바뀌면(결과 머리의 "이 구성으로 실제 이관") 렌더 중에 상태를 맞춘다. 요청 중이면 무시한다.
  const [handledRequest, setHandledRequest] = useState(realRequest);
  if (realRequest !== handledRequest) {
    setHandledRequest(realRequest);
    if (!busy && packageId !== null && selectionReason === null) {
      setMode('real');
      setDeploy(false);
      setConfirmOpen(true);
    }
  }

  const dryRun = mode === 'dryRun';
  const tooMany = artifactIds.length > MAX_ARTIFACTS;
  const canRun = packageId !== null && !tooMany && !busy && selectionReason === null;

  function changeMode(next: RunMode) {
    setMode(next);
    // 드라이런으로 바꾸면 배포 스위치가 사라지고 값은 꺼짐으로 돌아간다.
    if (next === 'dryRun') setDeploy(false);
  }

  async function submit() {
    if (inFlight.current || packageId === null || tooMany || !sourceTenantId || !targetTenantId || selectionReason) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // 선택 0개면 artifactIds 키 자체를 보내지 않는다(패키지 전체 대상). 드라이런 요청은 항상 deploy: false다(REQ-104 AC-5).
    const body: TransportRequest = { packageId, dryRun, deploy: dryRun ? false : deploy, sourceTenantId, targetTenantId };
    if (artifactIds.length > 0) body.artifactIds = artifactIds;
    onRequest?.(body);
    try {
      onResult(await postTransport(body));
    } catch (e) {
      onResult(null);
      setError(toApiError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  function onRunClick() {
    if (!canRun) return;
    if (dryRun) void submit();
    else setConfirmOpen(true);
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <dl className="grid gap-2 rounded-md bg-surface px-3 py-2.5">
        <SummaryRow label="패키지">
          {packageId === null ? (
            <span className="text-ink-tertiary">선택 안 됨</span>
          ) : (
            <>
              {packageName && <span className="font-medium">{packageName} </span>}
              <span className="font-mono text-[13px] text-ink-secondary">{packageId}</span>
            </>
          )}
        </SummaryRow>
        <SummaryRow label="아티팩트">
          {packageId === null ? (
            <span className="text-ink-tertiary">—</span>
          ) : artifactIds.length === 0 ? (
            '패키지의 모든 아티팩트가 대상'
          ) : (
            `${artifactIds.length}개 선택`
          )}
        </SummaryRow>
      </dl>
      <RunModeSelect targetName={targetName} mode={mode} onChange={changeMode} />
      {!dryRun && (
        <Switch
          label="배포"
          description={`이관 후 ${targetName}에 배포합니다`}
          checked={deploy}
          onChange={(e) => setDeploy(e.target.checked)}
        />
      )}
      {!dryRun && <Callout tone="warning">{`실제 이관입니다. ${targetName}에 업로드합니다.`}</Callout>}
      {selectionReason && <p className="text-sm text-ink-secondary">{selectionReason}</p>}
      {tooMany && <p className="text-sm text-danger-fg">한 번에 100개까지 선택할 수 있습니다</p>}
      <Button ref={runBtn} variant="primary" fullWidth loading={busy} onClick={onRunClick} disabled={!canRun}>
        {dryRun ? '드라이런 실행' : `${targetName}로 이관`}
      </Button>
      {busy && !confirmOpen && (
        <p role="status" className="text-sm text-ink-secondary">
          이관 실행 중
        </p>
      )}
      {error && <ErrorAlert error={error} />}
      {confirmOpen && packageId !== null && selectionReason === null && (
        <ConfirmDialog
          targetName={targetName}
          packageId={packageId}
          artifactCount={artifactIds.length}
          deploy={deploy}
          busy={busy}
          onConfirm={() => void submit()}
          onCancel={() => setConfirmOpen(false)}
          fallbackFocusRef={runBtn}
        />
      )}
    </div>
  );
}
