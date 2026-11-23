import { useContext, useState } from 'react';
import { retryTransport } from '../../api/client';
import { toApiError, type ApiError } from '../../api/errors';
import type { ArtifactResult, TransportHistoryEntry } from '../../api/types';
import { jobHref } from '../../app/routes';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { PACKAGE_REFERENCE_NOTICE, TYPE_LABELS, typeOf } from '../../lib/artifactTypes';
import { ActiveJobContext, ActiveJobNotice } from '../job/ActiveJobBanner';
import { useTenants } from '../tenants/TenantContext';

function failureLabel(grade: ArtifactResult['grade']) {
  if (grade === 'FIX_REQUIRED') return '고쳐야 함';
  if (grade === 'RETRYABLE') return '다시 시도 가능';
  return '실패';
}

export function RetryDialog({ result, onClose }: { result: TransportHistoryEntry; onClose: () => void }) {
  const active = useContext(ActiveJobContext);
  const { readOnly, status } = useTenants();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const disabled = active !== null || readOnly !== false;

  async function run() {
    if (disabled || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const job = await retryTransport(result.transportId);
      window.location.hash = jobHref(job.jobId);
    } catch (cause) {
      setError(toApiError(cause));
      setBusy(false);
    }
  }

  const failures = result.results.filter(item => item.status === 'FAILED');
  return <Modal title="실패분 다시 이관" onClose={onClose} busy={busy}>
    <div className="flex min-w-0 flex-col gap-3 wrap-anywhere">
      <p>{result.sourceTenant?.name ?? result.sourceTenant?.id ?? 'DEV'} → {result.targetTenant?.name ?? result.targetTenant?.id ?? 'PRD'}</p>
      <p>{result.deploy ? '배포 켬' : '배포 끔'}</p>
      <p className="text-sm">{PACKAGE_REFERENCE_NOTICE}</p>
      <ul aria-label="다시 이관할 iFlow" className="divide-y divide-hairline">
        {result.packages.flatMap(pkg => {
          const failed = failures.filter(item => (item.packageId ?? result.packages[0]?.packageId) === pkg.packageId)
            .map(item => ({ id: item.artifactId, type: typeOf(item), label: failureLabel(item.grade) }));
          const skipped = (result.skipped ?? []).filter(item => item.packageId === pkg.packageId)
            .map(item => ({ id: item.artifactId, type: typeOf(item), label: '건너뜀' }));
          return [...failed, ...skipped].map((item, index) =>
            <li key={`${pkg.packageId}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
              <span className="min-w-0">
                {result.packages.length > 1 && <span className="block text-xs text-ink-secondary">{pkg.packageId}</span>}
                <span className="font-mono text-sm">{item.id}</span>
                <span className="ml-2 text-xs text-ink-secondary">{TYPE_LABELS[item.type]}</span>
              </span>
              <span className="text-sm">{item.label}</span>
            </li>);
        })}
      </ul>
      {active && <p><ActiveJobNotice jobId={active.jobId} /></p>}
      {readOnly && <p>읽기 전용 모드입니다. 실제 이관은 꺼져 있습니다</p>}
      {status.state === 'error' && <ErrorAlert error={status.error} />}
      {error && <ErrorAlert error={error} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>취소</Button>
        <Button variant="primary" onClick={run} loading={busy} disabled={disabled}>실행</Button>
      </div>
    </div>
  </Modal>;
}
