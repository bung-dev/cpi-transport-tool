import { createContext, useEffect, useState } from 'react';
import { getActiveTransportJob, getTransportJob } from '../../api/client';
import { JOB_ALREADY_RUNNING } from '../../api/errors';
import type { ActiveJob } from '../../api/types';
import { jobHref } from '../../app/routes';
import { noticeJobFinished } from '../notice/completionNotice';

export const ActiveJobContext = createContext<ActiveJob | null | undefined>(undefined);

export function useActiveJob() {
  const [job, setJob] = useState<ActiveJob | null>();
  useEffect(() => {
    let stopped = false;
    const runningIds = new Set<string>();
    const pendingLookups = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    async function checkMissingJob(id: string) {
      // 조회 중 띠에 같은 ID가 다시 보이면 그 관찰은 다음 조회까지 남긴다.
      runningIds.delete(id);
      pendingLookups.add(id);
      const detail = await getTransportJob(id).catch(() => undefined);
      pendingLookups.delete(id);
      if (stopped || !detail) return;
      if (detail.status === 'RUNNING') runningIds.add(id);
      else noticeJobFinished(detail);
    }

    async function poll() {
      const active = await getActiveTransportJob().catch(() => undefined);
      if (stopped) return;
      setJob(active ?? null);
      if (active) runningIds.add(active.jobId);
      for (const id of runningIds) {
        if (id !== active?.jobId && !pendingLookups.has(id)) void checkMissingJob(id);
      }
      timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return job;
}

export function ActiveJobBanner({ job }: { job: ActiveJob }) {
  return <div role="status" aria-label="실제 이관 진행 중" className="bg-primary-soft text-primary">
    <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-2 px-4 py-2 text-sm md:px-6">
      <span>실제 이관 진행 중 {job.done}/{job.total}</span>
      <span aria-hidden="true">—</span>
      <a href={jobHref(job.jobId)} className="font-medium underline">보기</a>
    </div>
  </div>;
}

export function ActiveJobNotice({ jobId, onView }: { jobId: string; onView?: () => void }) {
  return <>{JOB_ALREADY_RUNNING}{' '}
    <a href={jobHref(jobId)} onClick={onView} className="text-primary underline">진행 중인 작업 보기</a>
  </>;
}
