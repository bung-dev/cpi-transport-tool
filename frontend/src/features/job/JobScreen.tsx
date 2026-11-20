import { useState, useSyncExternalStore } from 'react';
import { cancelTransportJob } from '../../api/client';
import { ApiRequestError, toApiError, type ApiError } from '../../api/errors';
import type { TransportJob } from '../../api/types';
import { readQuery, subscribeToHashChange } from '../../app/routes';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { TransportResult } from '../result/TransportResult';
import { JobItems, JobProgressBar } from './JobProgress';
import { useJobPolling } from './useJobPolling';

const titles = {
  RUNNING: '실제 이관 중', COMPLETED: '실제 이관 완료', CANCELLED: '실제 이관 취소됨', INTERRUPTED: '실제 이관 중단됨',
};

function duration(start: string, end: string) {
  const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000));
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function JobScreen({ onNew }: { onNew: () => void }) {
  const query = useSyncExternalStore(subscribeToHashChange, readQuery);
  const id = new URLSearchParams(query).get('id') ?? '';
  return <JobDetail key={id} id={id} onNew={onNew} />;
}

function JobDetail({ id, onNew }: { id: string; onNew: () => void }) {
  const [job, setJob] = useState<TransportJob>();
  const [failure, setFailure] = useState<'missing' | 'failed'>();
  const [confirm, setConfirm] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelError, setCancelError] = useState<ApiError>();
  useJobPolling(failure ? undefined : id, setJob, () => setFailure('failed'), () => setFailure('missing'));

  async function cancel() {
    if (cancelRequested) return;
    setConfirm(false);
    setCancelRequested(true);
    setCancelError(undefined);
    try {
      await cancelTransportJob(id);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) return;
      setCancelError(toApiError(error));
      setCancelRequested(false);
    }
  }

  if (!id || failure === 'missing') return <section aria-label="실제 이관 작업">
    <PageHeader title="작업을 찾을 수 없습니다" />
    <a href="#/history" aria-label="이관 이력 목록 보기" className="text-primary underline">이관 이력</a>
  </section>;
  if (failure) return <section aria-label="실제 이관 작업">
    <ErrorAlert error={{ title: '진행 상황을 불러오지 못했습니다' }} onRetry={() => setFailure(undefined)} />
  </section>;
  if (!job) return <ListSkeleton />;
  const running = job.status === 'RUNNING';
  const result = job.result;
  return <section aria-label="실제 이관 작업" className="min-w-0 wrap-anywhere">
    <PageHeader title={titles[job.status]} description={running ? `${job.sourceTenant?.name ?? '-'} → ${job.targetTenant?.name ?? '-'}` : undefined} />
    <div className="flex min-w-0 flex-col gap-4 break-words">
      <Card title={running ? `실제 이관 중 ${job.done}/${job.total}` : 'iFlow 진행'}
        actions={running && <Button size="sm" disabled={cancelRequested} onClick={() => setConfirm(true)}>취소</Button>}>
        {running && <JobProgressBar label="실제 이관 진행률" done={job.done} total={job.total} />}
        <JobItems items={job.items} />
      </Card>
      {running && cancelError && <ErrorAlert error={cancelError} />}
      {!running && <>
        {job.finishedAt && <p>걸린 시간 {duration(job.startedAt, job.finishedAt)}</p>}
        {result && <TransportResult result={result} />}
        <div className="flex flex-wrap justify-end gap-2">
          {result && <Button onClick={() => { window.location.hash = `#/history?transportId=${encodeURIComponent(result.transportId)}`; }}>이관 이력에서 보기</Button>}
          <Button variant="primary" onClick={onNew}>새 이관 시작</Button>
        </div>
      </>}
    </div>
    {running && confirm && <Modal title="실제 이관 취소" onClose={() => setConfirm(false)}>
      <p>처리 중인 iFlow는 끝까지 진행하고, 대기 중인 iFlow는 건너뜁니다.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button onClick={() => setConfirm(false)}>계속 진행</Button>
        <Button variant="primary" onClick={cancel}>취소 요청</Button>
      </div>
    </Modal>}
  </section>;
}
