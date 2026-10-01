import { useRef, useState } from 'react';
import { postTransport } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { TransportRequest, TransportResponse } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from './ConfirmDialog';
import { TransportOptions } from './TransportOptions';

// 백엔드 검증(TransportController.java:31)과 같은 값
export const MAX_ARTIFACTS = 100;

interface Props {
  packageId: string | null;
  artifactIds: string[];
  onResult: (r: TransportResponse | null) => void;
}

export function RunPanel({ packageId, artifactIds, onResult }: Props) {
  const [dryRun, setDryRun] = useState(true);
  const [deploy, setDeploy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // AI-NOTE: 상태 갱신(busy)은 비동기라 disabled만으로는 같은 틱의 연속 클릭을 막지 못한다. 동기 플래그로 중복 전송을 막는다 (근거: REQ-005 AC-4, run 20260929-frontend-ui)
  const inFlight = useRef(false);

  const tooMany = artifactIds.length > MAX_ARTIFACTS;
  const canRun = packageId !== null && !tooMany && !busy;

  async function submit() {
    if (inFlight.current || packageId === null || tooMany) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // 선택 0개면 artifactIds 키 자체를 보내지 않는다(패키지 전체 대상).
    const body: TransportRequest = { packageId, dryRun, deploy };
    if (artifactIds.length > 0) body.artifactIds = artifactIds;
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
    if (dryRun) void submit();
    else setConfirmOpen(true);
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <TransportOptions dryRun={dryRun} deploy={deploy} onDryRunChange={setDryRun} onDeployChange={setDeploy} />
      {packageId !== null && artifactIds.length === 0 && (
        <p className="text-sm text-ink-secondary">패키지의 모든 아티팩트가 대상</p>
      )}
      {tooMany && (
        <p className="text-sm text-danger-fg">한 번에 100개까지 선택할 수 있습니다</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="primary" onClick={onRunClick} disabled={!canRun}>
          이관 실행
        </Button>
        {busy && !confirmOpen && (
          <p role="status" className="text-sm text-ink-secondary">
            이관 실행 중
          </p>
        )}
      </div>
      {error && <ErrorAlert error={error} />}
      {confirmOpen && packageId !== null && (
        <ConfirmDialog
          packageId={packageId}
          artifactCount={artifactIds.length}
          deploy={deploy}
          busy={busy}
          onConfirm={() => void submit()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
